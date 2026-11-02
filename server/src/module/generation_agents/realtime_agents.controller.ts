import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { env } from "../../env.js";
import { ApiError } from "../../common/utils/ApiError.js";
import { IInputExamZodSchema } from "./Types/inputExam.js";
import { ConversationSummaryZodSchema } from "./Types/outputConversation.js";
import { persistIntentMemories } from "./agents/exam_intent_agent.js";
import { executeTool as executeReviewTool } from "./agents/blueprint_review_agent.js";
import { executeTool as executeQuestionReviewTool } from "./agents/question_review_agent.js";
import { getExamIntentSystemPrompt as getIntentSystemPrompt } from "../../prompts/exam_intent_agent.prompt.js";
import { getBlueprintReviewSystemPrompt as getReviewSystemPrompt } from "../../prompts/blueprint_review_agent.prompt.js";
import { getQuestionReviewSystemPrompt } from "../../prompts/question_review_agent.prompt.js";
import { ENGLISH_ONLY_DIRECTIVE, VOICE_ADDENDUM } from "../../prompts/realtime_voice.prompt.js";
import {
    getIntentAgentRealtimeTools,
    getReviewAgentRealtimeTools,
    getQuestionReviewAgentRealtimeTools,
} from "./realtime/tool_schemas.js";
import { buildGenerationContextBySection } from "./session_context.util.js";
import {
    createSession,
    getSession,
    completeSession,
    appendMessage,
    appendReviewMessage,
    updateBlueprint,
} from "./exam_intent_session.service.js";
import { getSectionsWithDetails } from "../sections/sections.service.js";
import { buildQuestionReviewContext } from "./question_review_context.util.js";
import type { Requester } from "../../common/permissions/index.js";
import { getUsableBook } from "../books/book_retrieval.js";

const toRequester = (req: Request): Requester => ({
    id: req.user!.id,
    role: req.user!.role,
});

const CreateRealtimeSessionRequestZodSchema = z.object({
    agent: z.enum(["intent", "review", "question_review"]),
    sessionId: z.string().optional(),
    // Only used to start a brand-new intent session (mirrors the text flow's
    // conversationTurnHandler "no sessionId" branch).
    examInput: IInputExamZodSchema.optional(),
    // Only used by the question review agent — it operates on the real,
    // already-saved exam (questions/options tables), not a generation
    // session, so it's addressed by examId instead of sessionId.
    examId: z.string().optional(),
});

export const createRealtimeSessionHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        const parsed = CreateRealtimeSessionRequestZodSchema.safeParse(req.body);
        if (!parsed.success) {
            const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
            throw ApiError.badRequest(`Invalid request body: ${issues}`);
        }
        const { agent, examInput, examId } = parsed.data;
        let { sessionId } = parsed.data;
        const userId = req.user!.id;

        let instructions: string;
        let tools: unknown[];

        if (agent === "question_review") {
            if (!examId) throw ApiError.badRequest("examId is required for the question review agent");
            // Throws forbidden/not-found itself if the requester can't manage this exam.
            const examStructure = await getSectionsWithDetails(examId, toRequester(req));
            instructions = `${ENGLISH_ONLY_DIRECTIVE}\n\n${getQuestionReviewSystemPrompt()}${VOICE_ADDENDUM}\n\nCURRENT EXAM STRUCTURE (sections, blocks, and questions — each question has a unique "id"; each section/block has an "id"):\n${JSON.stringify(buildQuestionReviewContext(examStructure))}`;
            tools = getQuestionReviewAgentRealtimeTools();
            sessionId = examId;
        } else if (agent === "intent") {
            if (!sessionId) {
                if (!examInput) throw ApiError.badRequest("examInput is required to start a new intent session");
                if (examInput.bookId) {
                    await getUsableBook(examInput.bookId, { userId });
                }
                const session = await createSession(examInput, userId);
                sessionId = session.id;
            } else {
                const session = await getSession(sessionId);
                if (!session) throw ApiError.notFound("Session not found");
                if (session.createdBy !== userId) throw ApiError.forbidden("Not your session");
            }
            instructions = `${ENGLISH_ONLY_DIRECTIVE}\n\n${getIntentSystemPrompt()}${VOICE_ADDENDUM}`;
            tools = getIntentAgentRealtimeTools();
        } else {
            if (!sessionId) throw ApiError.badRequest("sessionId is required for the review agent");
            const session = await getSession(sessionId);
            if (!session) throw ApiError.notFound("Session not found");
            if (session.createdBy !== userId) throw ApiError.forbidden("Not your session");
            if (session.blueprintStatus !== "completed" || !session.blueprint) {
                throw ApiError.badRequest("Blueprint is not ready yet");
            }
            instructions = `${ENGLISH_ONLY_DIRECTIVE}\n\n${getReviewSystemPrompt()}${VOICE_ADDENDUM}\n\nCURRENT EXAM BLUEPRINT (all sections, JSON):\n${JSON.stringify(session.blueprint.sections)}`;
            tools = getReviewAgentRealtimeTools();
        }

        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) throw ApiError.internal("OPENAI_API_KEY is not set on the server");

        const openaiRes = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                session: {
                    type: "realtime",
                    model: env.REALTIME_MODEL,
                    instructions,
                    tools,
                    tool_choice: "auto",
                    audio: {
                        input: {
                            format: { type: "audio/pcm", rate: 24000 },
                            // Hints Whisper the input is English — without this it can
                            // occasionally mis-hear/mis-transcribe speech as another
                            // language, which then leads the model to answer in kind.
                            transcription: { model: "whisper-1", language: "en" },
                            turn_detection: { type: "server_vad" },
                        },
                        output: {
                            format: { type: "audio/pcm", rate: 24000 },
                            voice: env.REALTIME_VOICE,
                        },
                    },
                    output_modalities: ["audio"],
                },
            }),
        });

        if (!openaiRes.ok) {
            const errText = await openaiRes.text().catch(() => "");
            console.error("[generation-agents] realtime client_secrets request failed:", openaiRes.status, errText);
            throw ApiError.internal("Could not start the realtime voice session (OpenAI request failed)");
        }

        const data: any = await openaiRes.json();
        // Defensive extraction — verify the exact response shape against a
        // real call and simplify this once confirmed; different Realtime API
        // revisions have nested this token slightly differently.
        const clientSecret = data.value || data.client_secret?.value || data.client_secret;
        if (!clientSecret) {
            console.error("[generation-agents] unexpected realtime client_secrets response shape:", JSON.stringify(data));
            throw ApiError.internal("Unexpected response from OpenAI while starting the voice session");
        }

        console.log(`[generation-agents] minted realtime session (agent: ${agent}, session: ${sessionId})`);
        res.status(201).json({ success: true, data: { sessionId, clientSecret, model: env.REALTIME_MODEL } });
    } catch (error) {
        next(error);
    }
};

const RealtimeToolCallRequestZodSchema = z.object({
    sessionId: z.string(),
    name: z.string(),
    argsRaw: z.string(),
});

export const executeIntentRealtimeToolHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        const parsed = RealtimeToolCallRequestZodSchema.safeParse(req.body);
        if (!parsed.success) {
            const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
            throw ApiError.badRequest(`Invalid request body: ${issues}`);
        }
        const { sessionId, name, argsRaw } = parsed.data;

        const session = await getSession(sessionId);
        if (!session) throw ApiError.notFound("Session not found");
        if (session.createdBy !== req.user!.id) throw ApiError.forbidden("Not your session");

        if (name !== "save_exam_intent_summary") {
            res.status(200).json({ success: true, data: { output: { error: `Unknown tool "${name}".` } } });
            return;
        }

        const summary = ConversationSummaryZodSchema.parse(JSON.parse(argsRaw || "{}"));
        await completeSession(sessionId, summary);
        persistIntentMemories(summary, session.examInput.title, req.user!.id);

        console.log(`[generation-agents] realtime intent session ${sessionId} completed`);
        res.status(200).json({ success: true, data: { output: { done: true }, summary } });
    } catch (error) {
        next(error);
    }
};

export const executeReviewRealtimeToolHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        const parsed = RealtimeToolCallRequestZodSchema.safeParse(req.body);
        if (!parsed.success) {
            const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
            throw ApiError.badRequest(`Invalid request body: ${issues}`);
        }
        const { sessionId, name, argsRaw } = parsed.data;

        const session = await getSession(sessionId);
        if (!session) throw ApiError.notFound("Session not found");
        if (session.createdBy !== req.user!.id) throw ApiError.forbidden("Not your session");
        if (session.blueprintStatus !== "completed" || !session.blueprint) {
            throw ApiError.badRequest("Blueprint is not ready yet");
        }

        if (name === "finish_review") {
            let summaryMessage = "Got it — the plan is finalized.";
            try {
                summaryMessage = JSON.parse(argsRaw || "{}").summary_message || summaryMessage;
            } catch {
                // keep default
            }
            res.status(200).json({
                success: true,
                data: { done: true, output: { done: true }, sections: session.blueprint.sections, message: summaryMessage },
            });
            return;
        }

        const generationContextBySection = buildGenerationContextBySection(session);
        const result = await executeReviewTool(session.blueprint.sections, name, argsRaw, generationContextBySection);
        await updateBlueprint(sessionId, { sections: result.sections });

        res.status(200).json({
            success: true,
            data: { done: false, output: { resultText: result.resultText }, sections: result.sections, changeLog: result.changeLog },
        });
    } catch (error) {
        next(error);
    }
};

// Note: `sessionId` in the request body is actually the examId here (see
// createRealtimeSessionHandler, which returns examId back as "sessionId" so
// the client's generic tool-dispatch plumbing doesn't need an agent-specific
// case). The mutations themselves don't need it — create/update/delete
// question each verify access via the question's/section's own examId
// lookup internally (same as the manual question editor) — but it's used
// here to re-fetch the exam's fresh structure after every change, so the
// model's context (including any newly created question's id) stays current.
export const executeQuestionReviewRealtimeToolHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        const parsed = RealtimeToolCallRequestZodSchema.safeParse(req.body);
        if (!parsed.success) {
            const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
            throw ApiError.badRequest(`Invalid request body: ${issues}`);
        }
        const { sessionId: examId, name, argsRaw } = parsed.data;
        const requester = toRequester(req);

        if (name === "finish_review") {
            let summaryMessage = "Got it — the questions are finalized.";
            try {
                summaryMessage = JSON.parse(argsRaw || "{}").summary_message || summaryMessage;
            } catch {
                // keep default
            }
            res.status(200).json({ success: true, data: { done: true, output: { done: true }, message: summaryMessage } });
            return;
        }

        const result = await executeQuestionReviewTool(name, argsRaw, requester);
        const examStructure = await getSectionsWithDetails(examId, requester);

        res.status(200).json({
            success: true,
            data: {
                done: false,
                output: { resultText: result.resultText },
                // Full structure for the client to render; a separate
                // trimmed copy for it to re-inject back into the live voice
                // conversation. The Realtime API accumulates conversation
                // history, so unlike a single text-turn request, sending the
                // full structure here would repeat it — bigger each time —
                // in the model's context on every single tool call for the
                // rest of the session.
                sections: examStructure,
                reviewContext: buildQuestionReviewContext(examStructure),
                changeLog: result.changeLog,
            },
        });
    } catch (error) {
        next(error);
    }
};

const LogTurnRequestZodSchema = z.object({
    sessionId: z.string(),
    role: z.enum(["user", "assistant"]),
    content: z.string().min(1),
});

// Persists one recognized utterance from a voice conversation into the same
// message tables the text flows use — so a review/intent session's history
// looks the same (and is loadable the same way) whether it was typed or spoken.
export const logIntentTurnHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        const parsed = LogTurnRequestZodSchema.safeParse(req.body);
        if (!parsed.success) throw ApiError.badRequest("Invalid request body");
        const { sessionId, role, content } = parsed.data;

        const session = await getSession(sessionId);
        if (!session) throw ApiError.notFound("Session not found");
        if (session.createdBy !== req.user!.id) throw ApiError.forbidden("Not your session");

        await appendMessage(sessionId, role, content);
        res.status(200).json({ success: true, data: { ok: true } });
    } catch (error) {
        next(error);
    }
};

export const logReviewTurnHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        const parsed = LogTurnRequestZodSchema.safeParse(req.body);
        if (!parsed.success) throw ApiError.badRequest("Invalid request body");
        const { sessionId, role, content } = parsed.data;

        const session = await getSession(sessionId);
        if (!session) throw ApiError.notFound("Session not found");
        if (session.createdBy !== req.user!.id) throw ApiError.forbidden("Not your session");

        await appendReviewMessage(sessionId, role, content);
        res.status(200).json({ success: true, data: { ok: true } });
    } catch (error) {
        next(error);
    }
};
