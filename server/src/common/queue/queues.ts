import { Queue } from "bullmq";
import { env } from "../../env.js";

const connection = { url: env.REDIS_URL };

// Two kinds of job share this queue: "evaluate-submission" (an exam's written answers) and "evaluate-assignment".
export type EvaluationJobData = { submissionId: string; mode?: string };

export const evaluationQueue = new Queue<EvaluationJobData>("evaluation", {
    connection,
    defaultJobOptions: {
        // A job that fails is tried 3 times, waiting 5s then 10s in between.
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
        // Finished jobs are cleared after a while, so Redis does not fill up and a job's id can be used again. Failed ones
        // stay for a week so a problem can still be looked at.
        removeOnComplete: { age: 24 * 3600, count: 1000 },
        removeOnFail: { age: 7 * 24 * 3600 },
    },
});

/**
 * Puts a grading job in the queue, once per submission. If one for the same submission is already waiting or running it is
 * left alone; an old finished or failed one is cleared first, because BullMQ ignores a new job whose id is still in use.
 */
export async function enqueueEvaluation(name: "evaluate-submission" | "evaluate-assignment", data: EvaluationJobData) {
    const jobId = `${name === "evaluate-submission" ? "eval" : "eval-assignment"}-${data.submissionId}`;
    const existing = await evaluationQueue.getJob(jobId);
    if (existing) {
        const state = await existing.getState();
        if (state !== "completed" && state !== "failed") return existing;
        await existing.remove().catch(() => undefined);
    }
    return evaluationQueue.add(name, data, { jobId });
}
