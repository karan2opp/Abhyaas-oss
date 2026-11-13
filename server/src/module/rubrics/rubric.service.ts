import { and, eq, inArray, isNull } from "drizzle-orm";
import db from "../../common/db/index.js";
import { exams, questions, sections, submissions } from "../../common/db/schema.js";
import { inngest } from "../../common/inngest/client.js";
import { enqueueEvaluation } from "../../common/queue/queues.js";
import type { Rubric } from "./rubric_agent.js";

// A written question's grading guide (rubric) is written after the exam is built, once the teacher has had the chance to say
// how they mark (the exam's evaluationScheme). While the guides are being written the exam's rubricStatus is "pending":
// the exam itself stays usable, but students' answers wait in "evaluating" until the guides are ready.

const descriptiveQuestions = (examId: string) =>
    db
        .select({
            id: questions.id,
            description: questions.description,
            marks: questions.marks,
            contentBlocks: questions.contentBlocks,
            rubric: questions.rubric,
        })
        .from(questions)
        .innerJoin(sections, eq(questions.sectionId, sections.id))
        .where(and(eq(sections.examId, examId), eq(questions.type, "descriptive")));

/** The written questions of an exam that have no rubric yet. */
export async function loadQuestionsNeedingRubrics(examId: string) {
    const all = await descriptiveQuestions(examId);
    return all
        .filter((q) => q.rubric === null)
        .map((q) => ({ id: q.id, description: q.description, marks: q.marks, contentBlocks: (q.contentBlocks as unknown[] | null) ?? null }));
}

export async function saveRubric(questionId: string, rubric: Rubric) {
    await db.update(questions).set({ rubric, updatedAt: new Date() }).where(eq(questions.id, questionId));
}

/**
 * Answers that came in while the guides were being written are waiting in "evaluating" with no job behind them. Called once
 * the guides are ready (or have failed, so nothing waits forever) to put them in the grading queue. A submission that is
 * already queued is left alone.
 */
export async function releaseWaitingEvaluations(examId: string) {
    const waiting = await db.select({ id: submissions.id }).from(submissions).where(and(eq(submissions.examId, examId), eq(submissions.status, "evaluating")));
    for (const { id } of waiting) {
        try {
            await enqueueEvaluation("evaluate-submission", { submissionId: id, mode: "marks_and_feedback" });
        } catch (err) {
            // The recovery sweep (workers.ts) picks it up within minutes.
            console.error(`[Rubrics] Could not queue submission ${id} for grading:`, err);
        }
    }
}

/** Marks the exam's guides as ready or failed, and lets waiting answers be graded. */
export async function finishRubrics(examId: string, status: "ready" | "failed") {
    await db.update(exams).set({ rubricStatus: status, updatedAt: new Date() }).where(eq(exams.id, examId));
    await releaseWaitingEvaluations(examId);
}

/**
 * Starts writing the grading guides for an exam's written questions, in the background. Does nothing for an exam still being
 * built (status UNSAVED: the teacher has not had the evaluation-scheme question yet) or one with nothing left to write.
 * `regenerateAll` is for a changed evaluation scheme: every written question's rubric is cleared and written again.
 * Never throws: a problem here must not fail the teacher's save.
 */
export async function scheduleRubrics(examId: string, options: { regenerateAll?: boolean } = {}): Promise<void> {
    try {
        const [exam] = await db.select({ status: exams.status, rubricStatus: exams.rubricStatus }).from(exams).where(eq(exams.id, examId));
        if (!exam || exam.status === "UNSAVED") return;

        if (options.regenerateAll) {
            const all = await descriptiveQuestions(examId);
            if (all.length > 0) await db.update(questions).set({ rubric: null }).where(inArray(questions.id, all.map((q) => q.id)));
        }

        const needing = await loadQuestionsNeedingRubrics(examId);
        if (needing.length === 0) {
            if (exam.rubricStatus === "pending") await finishRubrics(examId, "ready");
            return;
        }

        await db.update(exams).set({ rubricStatus: "pending" }).where(eq(exams.id, examId));
        try {
            await inngest.send({ name: "exam/rubrics.generate", data: { examId } });
        } catch (err) {
            // Could not hand the work over (background service not reachable): grade without guides instead of waiting for ever.
            console.error(`[Rubrics] Could not start writing rubrics for exam ${examId}:`, err);
            await finishRubrics(examId, "failed");
        }
    } catch (err) {
        console.error(`[Rubrics] Could not schedule rubrics for exam ${examId}:`, err);
    }
}
