import type { Request, Response, NextFunction } from "express";
import { examIntentAgentTurn, concludeExamIntent, SKIP_QUESTION_SIGNAL } from "./agents/exam_intent_agent.js";
import { blueprintReviewAgentTurn } from "./agents/blueprint_review_agent.js";
import { generateTopicQuestions } from "./agents/generation_agent.js";
import { IInputExamZodSchema } from "./Types/inputExam.js";
import { ExamBlueprintZodSchema } from "./Types/outputSubtopics.js";
import { buildGenerationContextBySection } from "./session_context.util.js";
import {
    createSession,
    getSession,
    getSessionHistory,
    appendMessage,
    completeSession,
    setBlueprintInProgress,
    setQuestionsInProgress,
    updateBlueprint,
    getReviewHistory,
    appendReviewMessage,
    getQuestionReviewHistory,
    appendQuestionReviewMessage,
} from "./exam_intent_session.service.js";
import { questionReviewAgentTurn } from "./agents/question_review_agent.js";
import { buildQuestionReviewContext } from "./question_review_context.util.js";
import { getSectionsWithDetails } from "../sections/sections.service.js";
import { inngest } from "../../common/inngest/client.js";
import { rescaleSection, sectionTotal } from "./blueprint_edit_ops.js";
import { z } from "zod";
import { ApiError } from "../../common/utils/ApiError.js";
import { getUsableBook } from "../books/book_retrieval.js";
import { assertQuota, recordUsage } from "../plans/quota.service.js";
import { countBlueprintQuestions } from "./allocation.js";
import { openEventStream, sendStreamError, type EventStream } from "../../common/http/sse.js";

const ConversationTurnRequestZodSchema = z.object({
    // Required to start a new conversation (no sessionId); ignored once a
    // session exists — the DB snapshot from session start is the source of
    // truth from then on.
    examInput: IInputExamZodSchema.optional(),
    sessionId: z.string().optional(),
    // Required to continue an existing session — the teacher's reply.
    message: z.string().optional(),
    // The "Skip Question" / "Skip All Questions" chat buttons, as a control
    // signal rather than freeform text — mutually exclusive with `message`,
    // and only meaningful once a session exists (there's nothing to skip
    // before the first question has been asked).
    action: z.enum(["skip_question", "skip_all"]).optional(),
});

export const conversationTurnHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    let stream: EventStream | null = null;
    try {
        const parsed = ConversationTurnRequestZodSchema.safeParse(req.body);
        if (!parsed.success) {
            const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
            throw ApiError.badRequest(`Invalid request body: ${issues}`);
        }
        const { examInput, sessionId, message, action } = parsed.data;
        const userId = req.user!.id;

        let session;
        let effectiveMessage: string | null = null;
        if (!sessionId) {
            if (!examInput) throw ApiError.badRequest("examInput is required to start a conversation");
            if (action) throw ApiError.badRequest("action is only valid once a conversation has started");
            if (examInput.bookId) {
                await getUsableBook(examInput.bookId, { userId });
            }
            session = await createSession(examInput, userId);
            console.log(`[generation-agents] started exam intent session ${session.id}`);
        } else {
            session = await getSession(sessionId);
            if (!session) throw ApiError.notFound("Session not found");
            if (session.createdBy !== userId) throw ApiError.forbidden("Not your session");

            if (action === "skip_question") {
                effectiveMessage = SKIP_QUESTION_SIGNAL;
            } else if (action === "skip_all") {
                effectiveMessage = "(Skipped all remaining questions)";
            } else {
                if (!message || !message.trim()) throw ApiError.badRequest("message is required to continue a conversation");
                effectiveMessage = message.trim();
            }
            await appendMessage(session.id, "user", effectiveMessage);
        }

        const history = sessionId ? await getSessionHistory(session.id) : [];
        console.log(`[generation-agents] exam intent turn (session ${session.id}, history length: ${history.length}${action ? `, action: ${action}` : ""})`);

        stream = openEventStream(res);
        const hooks = {
            onText: (text: string) => stream!.send({ type: "delta", text }),
            onReset: () => stream!.send({ type: "reset" }),
        };

        let result;
        if (action === "skip_all") {
            // Always ends the conversation: the summary-only call can't ask another question, and if it
            // fails outright the teacher still moves on (with an empty summary) instead of being stuck.
            let summary;
            try {
                summary = await concludeExamIntent(session.examInput, history, userId);
            } catch (err) {
                console.warn(`[generation-agents] session ${session.id} could not summarize after skip-all — falling back to an empty summary:`, err instanceof Error ? err.message : err);
                summary = { goal: "", globalInstructions: [], topicSpecificInstructions: [] };
            }
            result = { done: true, message: "Got it — moving on with what you've already shared.", summary };
        } else {
            result = await examIntentAgentTurn(session.examInput, history, userId, hooks);
        }

        await appendMessage(session.id, "assistant", result.message);

        if (result.done && result.summary) {
            await completeSession(session.id, result.summary);
            console.log(`[generation-agents] exam intent session ${session.id} completed`);
        }

        // Fire-and-forget: shadow-trace this turn into Inngest for dashboard
        // visibility, without delaying the chat response on it.
        void inngest.send({
            name: "generation-agent/exam-intent.turn",
            data: {
                sessionId: session.id,
                turn: sessionId ? "continue" : "start",
                historyLength: history.length,
                userMessage: effectiveMessage,
                action: action ?? null,
                agentMessage: result.message,
                done: result.done,
                hasSummary: Boolean(result.summary),
            },
        }).catch((err) => {
            console.warn("[generation-agents] failed to send exam-intent trace event (Inngest dev server down?):", err?.message);
        });

        stream.send({ type: "result", data: { sessionId: session.id, ...result } });
        stream.end();
    } catch (error) {
        // Once the reply has started it can no longer be sent as a normal error reply, so it goes down the stream.
        if (stream) {
            sendStreamError(stream, error);
            stream.end();
            return;
        }
        next(error);
    }
};

export const triggerBlueprintGenerationHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        const { sessionId } = req.body || {};
        if (!sessionId || typeof sessionId !== "string") throw ApiError.badRequest("sessionId is required");

        const session = await getSession(sessionId);
        if (!session) throw ApiError.notFound("Session not found");
        if (session.createdBy !== req.user!.id) throw ApiError.forbidden("Not your session");
        if (session.status !== "completed") throw ApiError.badRequest("Intent conversation is not complete yet");

        await setBlueprintInProgress(session.id);
        try {
            await inngest.send({ name: "generation-agent/blueprint.generate", data: { sessionId: session.id } });
        } catch (sendError) {
            throw ApiError.internal("Could not reach the background job service (Inngest) — is it running?");
        }
        console.log(`[generation-agents] triggered blueprint generation for session ${session.id}`);

        res.status(202).json({ success: true, data: { sessionId: session.id, blueprintStatus: "in_progress" } });
    } catch (error) {
        next(error);
    }
};

export const getBlueprintStatusHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        const sessionId = String(req.params.sessionId);
        const session = await getSession(sessionId);
        if (!session) throw ApiError.notFound("Session not found");
        if (session.createdBy !== req.user!.id) throw ApiError.forbidden("Not your session");

        res.status(200).json({
            success: true,
            data: {
                sessionId: session.id,
                blueprintStatus: session.blueprintStatus,
                blueprint: session.blueprint,
                blueprintError: session.blueprintError,
            },
        });
    } catch (error) {
        next(error);
    }
};

const BlueprintReviewTurnRequestZodSchema = z.object({
    sessionId: z.string(),
    message: z.string().min(1),
    // Optional override of the section tree to operate on — for a caller
    // (like the legacy tree-editor UI) whose own direct edits haven't been
    // persisted to this session's blueprint yet. When present, this becomes
    // the new source of truth (saved back at the end of the turn either way).
    sections: ExamBlueprintZodSchema.shape.sections.optional(),
});

export const blueprintReviewTurnHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    let stream: EventStream | null = null;
    try {
        const parsed = BlueprintReviewTurnRequestZodSchema.safeParse(req.body);
        if (!parsed.success) {
            const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
            throw ApiError.badRequest(`Invalid request body: ${issues}`);
        }
        const { sessionId, message, sections: sectionsOverride } = parsed.data;

        const session = await getSession(sessionId);
        if (!session) throw ApiError.notFound("Session not found");
        if (session.createdBy !== req.user!.id) throw ApiError.forbidden("Not your session");
        if (session.blueprintStatus !== "completed" || !session.blueprint) {
            throw ApiError.badRequest("Blueprint is not ready yet");
        }

        const startingSections = sectionsOverride ?? session.blueprint.sections;

        // Reloaded from Postgres every turn — this is what lets the agent
        // remember what was already discussed/changed earlier in this same
        // review conversation, across separate HTTP requests.
        const history = await getReviewHistory(sessionId);
        await appendReviewMessage(sessionId, "user", message);

        const generationContextBySection = buildGenerationContextBySection(session);

        stream = openEventStream(res);
        const hooks = {
            onText: (text: string) => stream!.send({ type: "delta", text }),
            onReset: () => stream!.send({ type: "reset" }),
        };

        const result = await blueprintReviewAgentTurn(startingSections, generationContextBySection, history, message, hooks);

        await appendReviewMessage(sessionId, "assistant", result.message);
        // Persisted every turn (not just when done) so the next turn — or a
        // page refresh — always resumes from the latest tool-call state.
        await updateBlueprint(sessionId, { sections: result.sections });

        console.log(`[generation-agents] blueprint review turn (session ${sessionId}, history length: ${history.length}, done: ${result.done})`);

        stream.send({
            type: "result",
            data: {
                sessionId,
                message: result.message,
                sections: result.sections,
                done: result.done,
                changeLog: result.changeLog,
            },
        });
        stream.end();
    } catch (error) {
        // Once the reply has started it can no longer be sent as a normal error reply, so it goes down the stream.
        if (stream) {
            sendStreamError(stream, error);
            stream.end();
            return;
        }
        next(error);
    }
};

// Everything saved about an Exam Intent conversation, so the page can pick it up again after a refresh or a trip
// back to the topics step: its messages, whether it has finished, and the plan if one was made from it.
export const getConversationHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        const sessionId = String(req.params.sessionId);
        const session = await getSession(sessionId);
        if (!session) throw ApiError.notFound("Session not found");
        if (session.createdBy !== req.user!.id) throw ApiError.forbidden("Not your session");

        res.status(200).json({
            success: true,
            data: {
                sessionId: session.id,
                status: session.status,
                history: await getSessionHistory(session.id),
                blueprintStatus: session.blueprintStatus,
                blueprint: session.blueprint,
            },
        });
    } catch (error) {
        next(error);
    }
};

export const getBlueprintReviewHistoryHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        const sessionId = String(req.params.sessionId);
        const session = await getSession(sessionId);
        if (!session) throw ApiError.notFound("Session not found");
        if (session.createdBy !== req.user!.id) throw ApiError.forbidden("Not your session");

        const history = await getReviewHistory(sessionId);
        res.status(200).json({
            success: true,
            data: { sessionId, history, blueprint: session.blueprint },
        });
    } catch (error) {
        next(error);
    }
};

const RebalanceBlueprintRequestZodSchema = z.object({
    sessionId: z.string(),
    // The plan as currently shown, including manual edits that aren't saved yet.
    sections: ExamBlueprintZodSchema.shape.sections,
});

// "Auto-balance" from the proceed check: rescales every section whose total no
// longer matches the count the teacher set on the exam form, keeping each
// section's current proportions. Plain code, no AI calls.
export const rebalanceBlueprintHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        const parsed = RebalanceBlueprintRequestZodSchema.safeParse(req.body);
        if (!parsed.success) {
            const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
            throw ApiError.badRequest(`Invalid request body: ${issues}`);
        }
        const { sessionId, sections } = parsed.data;

        const session = await getSession(sessionId);
        if (!session) throw ApiError.notFound("Session not found");
        if (session.createdBy !== req.user!.id) throw ApiError.forbidden("Not your session");
        if (session.blueprintStatus !== "completed" || !session.blueprint) {
            throw ApiError.badRequest("Blueprint is not ready yet");
        }

        const targets = new Map(session.examInput.sections.map((s) => [s.name, s.question_count]));
        const changes: { section: string; from: number; to: number; changeLog: string[] }[] = [];
        const rebalanced = sections.map((section) => {
            const target = targets.get(section.name);
            const total = sectionTotal(section);
            if (target === undefined || total === target) return section;
            const r = rescaleSection(section, target);
            changes.push({ section: section.name, from: total, to: target, changeLog: r.changeLog });
            return r.section;
        });

        await updateBlueprint(sessionId, { sections: rebalanced });
        res.status(200).json({ success: true, data: { sections: rebalanced, changes } });
    } catch (error) {
        next(error);
    }
};

const TriggerQuestionGenerationRequestZodSchema = z.object({
    sessionId: z.string(),
    // Optional final override — lets a caller sync last-minute manual edits
    // (e.g. from a direct tree editor) into the blueprint right before
    // generation starts, without a separate round trip.
    sections: ExamBlueprintZodSchema.shape.sections.optional(),
});

const QuestionReviewTurnRequestZodSchema = z.object({
    examId: z.string(),
    message: z.string().min(1),
});

// Text-chat turn for the Question Review Agent — the non-voice path to the
// same agent. Operates on the real saved exam, so the current structure is
// re-read each turn rather than carried in a session.
export const questionReviewTurnHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    let stream: EventStream | null = null;
    try {
        const parsed = QuestionReviewTurnRequestZodSchema.safeParse(req.body);
        if (!parsed.success) {
            const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
            throw ApiError.badRequest(`Invalid request body: ${issues}`);
        }
        const { examId, message } = parsed.data;

        const requester = {
            id: req.user!.id,
            role: req.user!.role,
        };

        // Throws forbidden/not-found itself if the requester can't manage this
        // exam — the same guard the voice session uses.
        const examStructure = await getSectionsWithDetails(examId, requester);

        // Loaded before the new message is stored, so the agent sees the
        // conversation as it stood, then this turn on top — the same ordering
        // the blueprint review agent uses.
        const history = await getQuestionReviewHistory(examId);
        await appendQuestionReviewMessage(examId, "user", message);

        // Trimmed for the MODEL only — the raw structure (returned below as
        // `sections`) is what the client renders and needs every field for.
        stream = openEventStream(res);
        const hooks = {
            onText: (text: string) => stream!.send({ type: "delta", text }),
            onReset: () => stream!.send({ type: "reset" }),
        };

        const result = await questionReviewAgentTurn(buildQuestionReviewContext(examStructure), history, message, requester, hooks);
        await appendQuestionReviewMessage(examId, "assistant", result.message);

        // Re-read after the turn so the client renders what was actually
        // written, not what it had before the edits.
        const updatedStructure = await getSectionsWithDetails(examId, requester);

        console.log(`[generation-agents] question review turn (exam ${examId}, ${result.changeLog.length} change(s), done: ${result.done})`);

        stream.send({
            type: "result",
            data: {
                examId,
                message: result.message,
                done: result.done,
                changeLog: result.changeLog,
                sections: updatedStructure,
            },
        });
        stream.end();
    } catch (error) {
        // Once the reply has started it can no longer be sent as a normal error reply, so it goes down the stream.
        if (stream) {
            sendStreamError(stream, error);
            stream.end();
            return;
        }
        next(error);
    }
};

// Lets the chat panel restore its transcript after a refresh — the agent
// already remembers, so the UI should too.
export const getQuestionReviewHistoryHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        const examId = String(req.params.examId);
        // Permission check: same guard as the turn handler.
        await getSectionsWithDetails(examId, {
            id: req.user!.id,
            role: req.user!.role,
        });

        const history = await getQuestionReviewHistory(examId);
        res.status(200).json({ success: true, data: { examId, history } });
    } catch (error) {
        next(error);
    }
};

export const triggerQuestionGenerationHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        const parsed = TriggerQuestionGenerationRequestZodSchema.safeParse(req.body);
        if (!parsed.success) {
            const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
            throw ApiError.badRequest(`Invalid request body: ${issues}`);
        }
        const { sessionId, sections: sectionsOverride } = parsed.data;

        const session = await getSession(sessionId);
        if (!session) throw ApiError.notFound("Session not found");
        if (session.createdBy !== req.user!.id) throw ApiError.forbidden("Not your session");
        if (session.blueprintStatus !== "completed" || !session.blueprint) {
            throw ApiError.badRequest("Blueprint is not ready yet");
        }

        // Refused before anything starts if the plan can't cover every question in the plan. What is actually produced is
        // recorded when each section is saved (see the generation function).
        await assertQuota(req.user!.id, "question_generation", countBlueprintQuestions(sectionsOverride ?? session.blueprint.sections));

        if (sectionsOverride) {
            await updateBlueprint(session.id, { sections: sectionsOverride });
        }

        await setQuestionsInProgress(session.id);
        try {
            await inngest.send({ name: "generation-agent/questions.generate", data: { sessionId: session.id } });
        } catch (sendError) {
            throw ApiError.internal("Could not reach the background job service (Inngest) — is it running?");
        }
        console.log(`[generation-agents] triggered question generation for session ${session.id}`);

        res.status(202).json({ success: true, data: { sessionId: session.id, questionsStatus: "in_progress" } });
    } catch (error) {
        next(error);
    }
};

export const getQuestionsStatusHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        const sessionId = String(req.params.sessionId);
        const session = await getSession(sessionId);
        if (!session) throw ApiError.notFound("Session not found");
        if (session.createdBy !== req.user!.id) throw ApiError.forbidden("Not your session");

        res.status(200).json({
            success: true,
            data: {
                sessionId: session.id,
                questionsStatus: session.questionsStatus,
                questions: session.questions,
                questionsError: session.questionsError,
            },
        });
    } catch (error) {
        next(error);
    }
};

const TopicQuestionGenerationRequestZodSchema = z.object({
    subject: z.string(),
    question_type: z.enum(["mcq", "descriptive"]),
    marks: z.number(),
    topic: z.string(),
    subtopics: z.array(z.object({ name: z.string(), count: z.number() })),
    globalInstructions: z.array(z.string()).optional().default([]),
    topicInstructions: z.array(z.string()).optional().default([]),
    difficulty: z.enum(["easy", "medium", "hard"]).optional(),
});

export const generateTopicQuestionsHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        const parsed = TopicQuestionGenerationRequestZodSchema.safeParse(req.body);
        if (!parsed.success) {
            const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
            throw ApiError.badRequest(`Invalid request body: ${issues}`);
        }
        await assertQuota(req.user!.id, "question_generation", parsed.data.subtopics.reduce((n, s) => n + s.count, 0));
        const output = await generateTopicQuestions(parsed.data);
        await recordUsage(req.user!.id, "question_generation", output.questions.length);
        res.status(200).json({ success: true, data: output });
    } catch (error) {
        next(error);
    }
};
