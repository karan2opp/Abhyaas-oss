import { eq } from "drizzle-orm";
import { inngest } from "../../../common/inngest/client.js";
import db from "../../../common/db/index.js";
import { exams } from "../../../common/db/schema.js";
import { bindAiUser } from "../../../common/agent/ai_context.js";
import { generateRubrics } from "../rubric_agent.js";
import { finishRubrics, loadQuestionsNeedingRubrics, saveRubric } from "../rubric.service.js";

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

export const rubricFunctions = [generateExamRubricsFunction];
