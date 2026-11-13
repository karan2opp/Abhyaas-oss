import { Worker } from "bullmq";
import { env } from "../../env.js";
import { evaluateDescriptiveAnswers, finalizeFailedEvaluation } from "../../module/submissions/submission.service.js";
import { evaluateAssignmentSubmission, finalizeFailedAssignmentEvaluation } from "../../module/assignments/assignment.service.js";
import { enqueueEvaluation, type EvaluationJobData } from "./queues.js";
import db from "../../common/db/index.js";
import { submissions, assignmentSubmissions } from "../../common/db/schema.js";
import { eq, and, lt, isNull, or } from "drizzle-orm";

const connection = { url: env.REDIS_URL };

// How long a submission may sit in "evaluating" before we consider it stuck
const STUCK_THRESHOLD_MINUTES = 10;

// A submission left in "evaluating" with no job behind it (Redis lost it, the queue could not be reached when the student
// submitted, ...) is put in the queue again. enqueueEvaluation leaves alone any submission whose job is still waiting or
// running, and clears an old failed job first, so this never starts a second copy and is never silently ignored.
const recoverStuckEvaluations = async () => {
    const cutoff = new Date(Date.now() - STUCK_THRESHOLD_MINUTES * 60 * 1000);

    try {
        const stuckExams = await db
            .select({ id: submissions.id, submittedAt: submissions.submittedAt })
            .from(submissions)
            .where(and(eq(submissions.status, "evaluating"), or(isNull(submissions.submittedAt), lt(submissions.submittedAt, cutoff))));

        for (const sub of stuckExams) {
            try {
                await enqueueEvaluation("evaluate-submission", { submissionId: sub.id, mode: "marks_and_feedback" });
                console.warn(`[Recovery] Re-checked stuck submission ${sub.id}` + (sub.submittedAt ? ` (submittedAt=${sub.submittedAt.toISOString()})` : ""));
            } catch (enqueueErr: any) {
                console.error(`[Recovery] Failed to re-enqueue ${sub.id}:`, enqueueErr.message);
            }
        }

        const stuckAssignments = await db
            .select({ id: assignmentSubmissions.id, submittedAt: assignmentSubmissions.submittedAt })
            .from(assignmentSubmissions)
            .where(and(eq(assignmentSubmissions.status, "evaluating"), or(isNull(assignmentSubmissions.submittedAt), lt(assignmentSubmissions.submittedAt, cutoff))));

        for (const sub of stuckAssignments) {
            try {
                await enqueueEvaluation("evaluate-assignment", { submissionId: sub.id });
                console.warn(`[Recovery] Re-checked stuck assignment submission ${sub.id}`);
            } catch (enqueueErr: any) {
                console.error(`[Recovery] Failed to re-enqueue assignment submission ${sub.id}:`, enqueueErr.message);
            }
        }
    } catch (e) {
        console.error("[Recovery] Sweep query failed:", e);
    }
};

let started = false;

export const startWorkers = () => {
    if (started) return;
    started = true;

    // Recover submissions left in "evaluating" due to crashes or lost jobs
    recoverStuckEvaluations().catch((e) =>
        console.error("[Recovery] Startup sweep failed:", e)
    );

    // Periodic recovery every 5 minutes
    setInterval(() => {
        recoverStuckEvaluations().catch((e) =>
            console.error("[Recovery] Periodic sweep failed:", e)
        );
    }, 5 * 60 * 1000);

    // How many jobs run at once. The number of answers being graded at the same moment is capped separately (EVAL_AI_CONCURRENCY).
    const worker = new Worker<EvaluationJobData>(
        "evaluation",
        async (job) => {
            const { submissionId, mode } = job.data;
            if (job.name === "evaluate-assignment") await evaluateAssignmentSubmission(submissionId);
            else await evaluateDescriptiveAnswers(submissionId, mode);
        },
        { connection, concurrency: 5 }
    );

    worker.on("failed", async (job, err) => {
        console.error(`Evaluation job ${job?.id} failed (try ${job?.attemptsMade}):`, err?.message);
        if (!job) return;

        // After the last try, stop retrying: what could not be graded is left for the teacher and the student gets their result.
        if (job.attemptsMade >= (job.opts.attempts ?? 1)) {
            try {
                if (job.name === "evaluate-assignment") await finalizeFailedAssignmentEvaluation(job.data.submissionId);
                else await finalizeFailedEvaluation(job.data.submissionId);
                console.warn(`[Evaluation] Gave up on ${job.id}; ungraded answers were left for the teacher.`);
            } catch (finalizeErr) {
                console.error(`[Evaluation] Could not close out ${job.id}:`, finalizeErr);
            }
        }
    });

    // Let jobs in the middle of grading finish when the server is asked to stop, instead of cutting them off.
    // It waits a few seconds at most; a job still running after that is picked up again by BullMQ, and what it had already
    // graded is kept.
    const shutdown = () => {
        Promise.race([worker.close(), new Promise((resolve) => setTimeout(resolve, 8000))]).finally(() => process.exit(0));
    };
    process.once("SIGTERM", shutdown);
    process.once("SIGINT", shutdown);

    console.log("BullMQ workers started.");
};
