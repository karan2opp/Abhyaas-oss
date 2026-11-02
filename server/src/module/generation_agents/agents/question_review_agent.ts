import { zodFunction } from "openai/helpers/zod";
import { z } from "zod";
import {
    AddQuestionArgsZodSchema,
    GenerateQuestionsArgsZodSchema,
    RemoveQuestionArgsZodSchema,
    UpdateQuestionArgsZodSchema,
    UpdateQuestionOptionsArgsZodSchema,
} from "../Types/outputQuestionReview.js";
import {
    applyAddQuestion,
    applyGenerateQuestions,
    applyRemoveQuestion,
    applyUpdateQuestion,
    applyUpdateQuestionOptions,
} from "../question_review_ops.js";
import type { Requester } from "../../../common/permissions/index.js";
import { getClientForModel, toolCallParams } from "../../../common/agent/openai.client.js";
import { streamChatCompletion, type StreamHooks } from "../../../common/agent/stream.js";
import { restoreNullBackslashes } from "../question_cleanup.util.js";
import { env } from "../../../env.js";
import type { ConversationTurn } from "../Types/outputConversation.js";
import { getQuestionReviewSystemPrompt } from "../../../prompts/question_review_agent.prompt.js";

export const tools = [
    zodFunction({
        name: "add_question",
        parameters: AddQuestionArgsZodSchema,
        description: "Add a new question exactly as dictated by the teacher (manual — no AI generation).",
    }),
    zodFunction({
        name: "generate_questions",
        parameters: GenerateQuestionsArgsZodSchema,
        description: "Generate 1 to 3 new AI-written questions for a topic/subtopic. Never more than 3 per call.",
    }),
    zodFunction({ name: "remove_question", parameters: RemoveQuestionArgsZodSchema, description: "Remove one question by id." }),
    zodFunction({
        name: "update_question",
        parameters: UpdateQuestionArgsZodSchema,
        description: "Update one existing question: send its complete new version (text, content blocks, and all options + correct answer for an MCQ, or the full rubric for a descriptive question).",
    }),
    zodFunction({
        name: "update_question_options",
        parameters: UpdateQuestionOptionsArgsZodSchema,
        description: "Change an MCQ question's options and/or correct answer.",
    }),
    zodFunction({
        name: "finish_review",
        parameters: z.object({ summary_message: z.string().describe("A short confirmation message to show the teacher") }),
        description: "Call only when the teacher explicitly confirms the question review is complete.",
    }),
];

export async function executeTool(
    name: string,
    argsRaw: string,
    requester: Requester
): Promise<{ resultText: string; changeLog: string[] }> {
    try {
        const args = restoreNullBackslashes(JSON.parse(argsRaw || "{}"));
        switch (name) {
            case "add_question": {
                const r = await applyAddQuestion(AddQuestionArgsZodSchema.parse(args), requester);
                return { resultText: r.changeLog.join(" "), changeLog: r.changeLog };
            }
            case "generate_questions": {
                const r = await applyGenerateQuestions(GenerateQuestionsArgsZodSchema.parse(args), requester);
                return { resultText: r.changeLog.join(" "), changeLog: r.changeLog };
            }
            case "remove_question": {
                const r = await applyRemoveQuestion(RemoveQuestionArgsZodSchema.parse(args), requester);
                return { resultText: r.changeLog.join(" "), changeLog: r.changeLog };
            }
            case "update_question": {
                const r = await applyUpdateQuestion(UpdateQuestionArgsZodSchema.parse(args), requester);
                return { resultText: r.changeLog.join(" "), changeLog: r.changeLog };
            }
            case "update_question_options": {
                const r = await applyUpdateQuestionOptions(UpdateQuestionOptionsArgsZodSchema.parse(args), requester);
                return { resultText: r.changeLog.join(" "), changeLog: r.changeLog };
            }
            default:
                return { resultText: `Unknown tool "${name}".`, changeLog: [] };
        }
    } catch (err: any) {
        return { resultText: `Error: ${err?.message || "the change could not be applied"}`, changeLog: [] };
    }
}

export interface QuestionReviewResult {
    message: string;
    done: boolean;
    changeLog: string[];
}

// A turn can trigger several edits in sequence ("reword Q3 and add one more
// on loops"); this caps how many rounds of tool calls one message can spend.
const MAX_TOOL_ROUNDS = 5;

/**
 * Text-chat turn for the Question Review Agent — the counterpart of the voice
 * session, for when voice isn't used. Identical
 * behaviour: same system prompt, same tools, same edits against the real
 * saved exam. Only the transport differs.
 *
 * Unlike the blueprint agent, this one has no in-memory state to thread
 * through: its tools write straight to the questions/options tables, so the
 * exam structure is re-read and handed back in on each turn by the caller.
 */
export async function questionReviewAgentTurn(
    examStructure: unknown,
    history: ConversationTurn[],
    userMessage: string,
    requester: Requester,
    hooks?: StreamHooks
): Promise<QuestionReviewResult> {
    const client = await getClientForModel(env.GENERATION_MODEL);

    const allChangeLog: string[] = [];
    let done = false;

    const messages: any[] = [
        { role: "system", content: getQuestionReviewSystemPrompt() },
        {
            role: "user",
            content: `CURRENT EXAM STRUCTURE (sections, blocks, and questions — each question has a unique "id"; each section/block has an "id"):\n${JSON.stringify(examStructure)}`,
        },
        ...history.map((turn) => ({ role: turn.role, content: turn.content })),
        { role: "user", content: userMessage },
    ];

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        // Streamed, so the teacher reads the reply as it is written. Tool calls are put together from the pieces they
        // arrive in and then handled exactly as before.
        const streamed = await streamChatCompletion(
            client,
            {
                model: env.GENERATION_MODEL,
                messages,
                tools,
                tool_choice: "auto",
                ...toolCallParams(env.GENERATION_MODEL),
            },
            hooks
        );

        const choice = { content: streamed.content || null };
        const toolCalls = streamed.toolCalls;

        if (toolCalls.length === 0) {
            return { message: choice?.content || "", done, changeLog: allChangeLog };
        }

        messages.push({ role: "assistant", content: choice?.content ?? null, tool_calls: toolCalls });

        for (const call of toolCalls) {
            if (call.type !== "function") continue;

            if (call.function.name === "finish_review") {
                done = true;
                let summaryMessage = "Got it — the questions are finalized.";
                try {
                    summaryMessage = JSON.parse(call.function.arguments || "{}").summary_message || summaryMessage;
                } catch {
                    // keep default
                }
                return { message: summaryMessage, done: true, changeLog: allChangeLog };
            }

            // Every tool here writes directly to the exam, and each one
            // re-checks the requester's permission on the way in.
            const result = await executeTool(call.function.name, call.function.arguments, requester);
            allChangeLog.push(...result.changeLog);
            messages.push({ role: "tool", tool_call_id: call.id, content: result.resultText || "Done." });
        }
    }

    return {
        message: "I've applied those changes — let me know if you'd like anything else adjusted.",
        done,
        changeLog: allChangeLog,
    };
}
