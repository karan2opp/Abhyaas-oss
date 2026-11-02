import { Worker } from "bullmq";
import { env } from "../../env.js";
import { evaluateDescriptiveAnswers } from "../../module/submissions/submission.service.js";
import { evaluationQueue } from "./queues.js";
import db from "../../common/db/index.js";
import { submissions } from "../../common/db/schema.js";
import { eq, and, sql, isNull, or } from "drizzle-orm";

const connection = { url: env.REDIS_URL };

// How long a submission may sit in "evaluating" before we consider it stuck
const STUCK_THRESHOLD_MINUTES = 10;

const recoverStuckEvaluations = async () => {
    try {
        const stuck = await db
            .select({
                id: submissions.id,
                submittedAt: submissions.submittedAt,
            })
            .from(submissions)
            .where(
                and(
                    eq(submissions.status, "evaluating"),
                    or(
                        isNull(submissions.submittedAt),
                        sql`${submissions.submittedAt} < NOW() - INTERVAL '10 minutes'`
                    )
                )
            );

        for (const sub of stuck) {
            try {
                await evaluationQueue.add(
                    "evaluate-submission",
                    { submissionId: sub.id, mode: "marks_and_feedback" },
                    {
                        jobId: `eval-recovery-${sub.id}`,
                        attempts: 3,
                        backoff: { type: "exponential", delay: 5000 },
                    }
                );
                console.warn(
                    `[Recovery] Re-enqueued stuck submission ${sub.id}` +
                    (sub.submittedAt ? ` (submittedAt=${sub.submittedAt.toISOString()})` : "")
                );
            } catch (enqueueErr: any) {
                console.error(`[Recovery] Failed to re-enqueue ${sub.id}:`, enqueueErr.message);
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

    // Recover submissions left in "evaluating" due to crashes or exhausted retries
    recoverStuckEvaluations().catch((e) =>
        console.error("[Recovery] Startup sweep failed:", e)
    );

    // Periodic recovery every 5 minutes
    setInterval(() => {
        recoverStuckEvaluations().catch((e) =>
            console.error("[Recovery] Periodic sweep failed:", e)
        );
    }, 5 * 60 * 1000);

    new Worker(
        "evaluation",
        async (job) => {
            const { submissionId, mode } = job.data;
            await evaluateDescriptiveAnswers(submissionId, mode);
        },
        { connection, concurrency: 5 }
    ).on("failed", (job, err) => console.error(`Evaluation job ${job?.id} failed:`, err?.message));

    console.log("BullMQ workers started.");
};
