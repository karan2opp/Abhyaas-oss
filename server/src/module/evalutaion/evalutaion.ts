import { z } from "zod";
import pLimit from "p-limit";
import { getClientForModel } from "../../common/agent/openai.client.js";
import { asAiKeyProblem } from "../../common/agent/ai_errors.js";
import { ApiError } from "../../common/utils/ApiError.js";
import { env } from "../../env.js";
import { runGuardrail, samplingFor } from "./agents/evalAgent.js";
import { getEvaluationPrompt } from "../../prompts/evaluation_agent.prompt.js";
import type { QuestionContentBlock } from "../questions/question.schema.js";

const ScoreSchema = z.object({ name: z.string(), score: z.coerce.number() });

/**
 * Reads the grader's reply. The prompt asks for { evaluations: [{ category_scores: [...], feedback }] }, but models sometimes
 * list the categories straight under "evaluations", or put "feedback" at the top, so all of those are understood. A reply
 * with no scores at all comes back with an empty list, which the caller treats as a failure to retry, never as 0 marks.
 */
const readGraderReply = (raw: unknown): { scores: { name: string; score: number }[]; marksAwarded: number | undefined; feedback: unknown } => {
    const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, any>;
    const evaluations: any[] = Array.isArray(obj.evaluations) ? obj.evaluations : [];
    const first = evaluations[0];

    let candidates: unknown[] = [];
    if (Array.isArray(first?.category_scores)) candidates = first.category_scores;
    else if (Array.isArray(obj.category_scores)) candidates = obj.category_scores;
    else candidates = evaluations;

    const scores = candidates.flatMap((c) => {
        const parsed = ScoreSchema.safeParse(c);
        return parsed.success ? [parsed.data] : [];
    });

    return {
        scores,
        marksAwarded: typeof obj.marksAwarded === "number" ? obj.marksAwarded : undefined,
        feedback: first?.feedback ?? obj.feedback ?? null,
    };
};

export type ResponseMode = "marks_only" | "marks_and_feedback";

export interface TextAnswer {
    answerId: string;
    questionId: string;
    question: string;
    modelAnswer?: string;
    studentAnswer: string;
    maxMarks: number;
    questionImages?: { url: string; publicId: string }[] | null;
    // Code/table/list the question depends on (e.g. "explain what this code
    // does") — without this the grader is judging the student's answer
    // against a question whose actual content it can't see.
    contentBlocks?: QuestionContentBlock[];
    rubric?: {
        categories: {
            name: string;
            weight: number;
            key_points: string[];
        }[];
    } | null;
}

export interface EvaluationOutcome {
    marksAwarded: number;
    feedback: string | null;
}

export const isBlankAnswer = (text: string | null | undefined): boolean => !text || text.trim().length === 0;

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);
const normName = (name: string) => name.trim().toLowerCase();

/**
 * Turns the grader's per-category scores (each 0 to 1) into marks.
 *
 * - Each score is held to 0–1, so one out-of-range number cannot lift or sink the whole mark.
 * - Weights are scaled to add up to 1, whatever scale the rubric was written on (0.4/0.4/0.2, 40/40/20, 2/2/1 ...).
 * - A rubric category the grader left out counts as 0 rather than quietly shrinking the total; a category the rubric does
 *   not have is ignored. If the grader renamed every category but kept the order, scores are matched by position.
 * - With no rubric the scores are simply averaged.
 */
export const calculateMarksFromScores = (
    categoryScores: { name: string; score: number }[],
    maxMarks: number,
    rubric?: { categories: { name: string; weight: number }[] } | null
): number => {
    const categories = rubric?.categories ?? [];
    let fraction = 0;

    if (categories.length > 0) {
        const byName = new Map(categoryScores.map((s) => [normName(s.name), clamp01(s.score)]));
        const anyNameMatches = categories.some((c) => byName.has(normName(c.name)));
        const positional = !anyNameMatches && categoryScores.length === categories.length;

        const weights = categories.map((c) => (Number.isFinite(c.weight) && c.weight > 0 ? c.weight : 0));
        const totalWeight = weights.reduce((sum, w) => sum + w, 0);

        categories.forEach((c, i) => {
            const weight = totalWeight > 0 ? weights[i]! / totalWeight : 1 / categories.length;
            const score = positional ? clamp01(categoryScores[i]!.score) : byName.get(normName(c.name)) ?? 0;
            fraction += score * weight;
        });
    } else if (categoryScores.length > 0) {
        fraction = categoryScores.reduce((sum, s) => sum + clamp01(s.score), 0) / categoryScores.length;
    }

    // Rounded to the nearest 0.1: category scores are on a fine 0–1 scale (see the prompt), so the mark can show it (2.3, 3.7).
    return Math.min(maxMarks, Math.max(0, Math.round(fraction * maxMarks * 10) / 10));
};

// Every call to OpenAI for grading goes through this one gate, so a rush of submissions waits its turn instead of all
// hitting OpenAI's rate limits at once.
const aiGate = pLimit(env.EVAL_AI_CONCURRENCY);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ── Single rubric-based evaluation round ──────────────────────────────────────
// Sends the question, rubric, reference answer, max marks, and student answer to the model, which
// returns per-category scores; marks are computed deterministically in code.
const evaluateSingleAnswer = async (
    answer: TextAnswer,
    retries = 2
): Promise<EvaluationOutcome> => {
    const modelToUse = env.EVALUATION_MODEL;
    const client = await getClientForModel(modelToUse);

    const inputObj: any = {
        question_text: answer.question,
        // The question's own code/table/list content, if it has any — the
        // question text may just say "the code below" without repeating it.
        content_blocks: answer.contentBlocks && answer.contentBlocks.length > 0 ? answer.contentBlocks : null,
        reference_answer: answer.modelAnswer?.trim() ? answer.modelAnswer : null,
        max_marks: answer.maxMarks,
        rubric: answer.rubric || null,
        student_answer: answer.studentAnswer,
    };

    const contentParts: any[] = [{ type: "text", text: JSON.stringify(inputObj, null, 2) }];

    if (answer.questionImages && answer.questionImages.length > 0) {
        answer.questionImages.forEach(img => {
            contentParts.push({
                type: "image_url",
                image_url: { url: img.url }
            });
        });
    }

    let attempt = 0;
    while (true) {
        try {
            const systemPrompt = getEvaluationPrompt();

            const response = await client.chat.completions.create({
                model: modelToUse,
                ...samplingFor(modelToUse),
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: contentParts }
                ],
                response_format: { type: "json_object" }
            });

            const resultStr = response.choices[0]?.message?.content || "{}";
            const reply = readGraderReply(JSON.parse(resultStr));

            let marksAwarded = reply.marksAwarded;
            const feedback = reply.feedback;
            if (reply.scores.length > 0) {
                marksAwarded = calculateMarksFromScores(reply.scores, answer.maxMarks, answer.rubric);
            }

            // No usable scores at all means the reply was broken, not that the answer earned 0: ask again.
            if (typeof marksAwarded !== "number" || !Number.isFinite(marksAwarded)) {
                throw new Error("The grader's reply had no scores");
            }
            marksAwarded = Math.min(answer.maxMarks, Math.max(0, marksAwarded));

            let feedbackString: string | null = null;
            if (typeof feedback === "string") {
                feedbackString = feedback;
            } else if (feedback && typeof feedback === "object") {
                const fb = feedback as { strengths?: string; improvements?: string; suggestion?: string };
                feedbackString = `Strengths: ${fb.strengths || ''}\nImprovements: ${fb.improvements || ''}\nSuggestion: ${fb.suggestion || ''}`;
            }

            return { marksAwarded, feedback: feedbackString };
        } catch (error) {
            // A rejected key, no credit or no model access: let the caller see the real error (it leaves the answer for the
            // teacher), and don't ask again.
            if (asAiKeyProblem(error)) throw error;
            if (attempt >= retries) {
                console.error("Evaluation error:", error);
                throw new ApiError(500, "Failed to evaluate answer");
            }
            console.log("Retrying evaluation...");
            await sleep(1000 * 2 ** attempt);
            attempt++;
        }
    }
};

// ── Unified evaluation (exams + assignments): guardrail + single rubric-based round ─
// Throws on error so callers (e.g. the BullMQ worker) can retry; it never turns a failure on our side into a mark.
export const evaluateAnswer = async (answer: TextAnswer, mode: ResponseMode = "marks_and_feedback"): Promise<EvaluationOutcome> => {
    // Nothing written: 0 marks, and no reason to spend AI calls on it.
    if (isBlankAnswer(answer.studentAnswer)) {
        return { marksAwarded: 0, feedback: mode === "marks_only" ? null : "No answer was written for this question." };
    }

    return aiGate(async () => {
        // Safety guardrail
        const guardrailResult = await runGuardrail(answer.studentAnswer);
        if (!guardrailResult.safe) {
            return {
                marksAwarded: 0,
                feedback: `Safety warning: ${guardrailResult.reason || "Potential prompt injection or instructions hijacking detected."}`,
            };
        }

        const outcome = await evaluateSingleAnswer(answer);
        return mode === "marks_only" ? { ...outcome, feedback: null } : outcome;
    });
};
