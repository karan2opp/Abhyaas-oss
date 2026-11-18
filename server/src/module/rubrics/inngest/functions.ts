import { eq } from "drizzle-orm";
import { inngest } from "../../../common/inngest/client.js";
import db from "../../../common/db/index.js";
import { assignments, exams } from "../../../common/db/schema.js";
import { bindAiUser, runAsAiUser } from "../../../common/agent/ai_context.js";
import { generateRubrics } from "../rubric_agent.js";
import {
    finishAssignmentRubrics,
    finishRubrics,
    loadAssignmentQuestionsNeedingRubrics,
    loadQuestionsNeedingRubrics,
    saveAssignmentRubric,
    saveRubric,
} from "../rubric.service.js";
import { bindUsageContext, withUsageSteps } from "../../../common/agent/usage_context.js";

// Questions are sent to the model a few at a time: fewer calls than one per question, and one bad reply costs only a batch.
const BATCH_SIZE = 5;

/**
 * Writes the grading guide for every written question of an exam that has none, following the teacher's evaluation scheme
 * when they gave one. Each batch is its own step, so a retry carries on where it stopped. Edits made in quick succession
 * start one run, not several (debounce), and only one run per exam at a time.
 */
export const generateExamRubricsFunction = inngest.createFunction(
    {
        id: "exam-generate-rubrics",
        retries: 2,
        debounce: { key: "event.data.examId", period: "10s" },
        concurrency: { key: "event.data.examId", limit: 1 },
        triggers: [{ event: "exam/rubrics.generate" }],
        // After the last retry: grade without guides rather than leave students' answers waiting for ever.
        onFailure: async ({ event }) => {
            const examId = (event.data.event.data as { examId?: string }).examId;
            if (examId) await finishRubrics(examId, "failed");
        },
    },
    async ({ event, step }) => {
        const examId = event.data.examId as string;
        // The AI work is billed to the teacher who owns the exam, with their own key.
        const [exam] = await db.select({ createdBy: exams.createdBy, evaluationScheme: exams.evaluationScheme }).from(exams).where(eq(exams.id, examId));
        if (!exam) return;
        bindAiUser(exam.createdBy);
        bindUsageContext({ examId });
        step = withUsageSteps(step, { examId }, (fn) => runAsAiUser(exam.createdBy, fn));

        const scheme = exam.evaluationScheme?.trim() || null;
        const pending = await step.run("load-questions", () => loadQuestionsNeedingRubrics(examId));

        for (let i = 0; i < pending.length; i += BATCH_SIZE) {
            const batch = pending.slice(i, i + BATCH_SIZE);
            await step.run(`write-rubrics-${i / BATCH_SIZE}`, async () => {
                const rubrics = await generateRubrics(batch, scheme);
                for (const q of batch) await saveRubric(q.id, rubrics.get(q.id)!);
            });
        }

        await step.run("finish", () => finishRubrics(examId, "ready"));
    }
);

/** The same, for an assignment's written questions (see scheduleAssignmentRubrics). */
export const generateAssignmentRubricsFunction = inngest.createFunction(
    {
        id: "assignment-generate-rubrics",
        retries: 2,
        debounce: { key: "event.data.assignmentId", period: "10s" },
        concurrency: { key: "event.data.assignmentId", limit: 1 },
        triggers: [{ event: "assignment/rubrics.generate" }],
        onFailure: async ({ event }) => {
            const assignmentId = (event.data.event.data as { assignmentId?: string }).assignmentId;
            if (assignmentId) await finishAssignmentRubrics(assignmentId, "failed");
        },
    },
    async ({ event, step }) => {
        const assignmentId = event.data.assignmentId as string;
        // The AI work is billed to the teacher who owns the assignment, with their own key.
        const [assignment] = await db
            .select({ createdBy: assignments.createdBy, evaluationScheme: assignments.evaluationScheme })
            .from(assignments)
            .where(eq(assignments.id, assignmentId));
        if (!assignment) return;
        bindAiUser(assignment.createdBy);
        bindUsageContext({ assignmentId });
        step = withUsageSteps(step, { assignmentId }, (fn) => runAsAiUser(assignment.createdBy, fn));
        const scheme = assignment.evaluationScheme?.trim() || null;
        const pending = await step.run("load-questions", () => loadAssignmentQuestionsNeedingRubrics(assignmentId));

        for (let i = 0; i < pending.length; i += BATCH_SIZE) {
            const batch = pending.slice(i, i + BATCH_SIZE);
            await step.run(`write-rubrics-${i / BATCH_SIZE}`, async () => {
                const rubrics = await generateRubrics(batch, scheme);
                for (const q of batch) await saveAssignmentRubric(q.id, rubrics.get(q.id)!);
            });
        }

        await step.run("finish", () => finishAssignmentRubrics(assignmentId, "ready"));
    }
);

export const rubricFunctions = [generateExamRubricsFunction, generateAssignmentRubricsFunction];
