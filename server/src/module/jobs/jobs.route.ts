import { Router } from "express";
import { authenticate } from "../../common/middleware/auth.middleware.js";
import { evaluationQueue } from "../../common/queue/queues.js";
import { canAccessSubmission } from "../submissions/submission.service.js";

const router = Router();

router.get("/:id", authenticate, async (req, res, next) => {
    try {
        const id = req.params.id as string;
        const job = await evaluationQueue.getJob(id);

        if (!job) {
            return res.status(404).json({ success: false, message: "Job not found" });
        }

        // BullMQ job ids are sequential and therefore guessable, so being
        // authenticated is not enough — the submission the job belongs to
        // decides who may read its state. Answers with the same 404 as a
        // missing job rather than 403, so this can't be used to confirm that
        // someone else's job exists.
        const submissionId = (job.data as { submissionId?: unknown } | undefined)?.submissionId;
        const allowed =
            typeof submissionId === "string" &&
            (await canAccessSubmission(submissionId, {
                id: req.user!.id,
                role: req.user!.role,
            }));

        if (!allowed) {
            return res.status(404).json({ success: false, message: "Job not found" });
        }

        const state = await job.getState();
        return res.json({
            success: true,
            data: {
                id,
                status: state,
                progress: job.progress,
                result: job.returnvalue,
                error: job.failedReason,
            },
        });
    } catch (err) {
        return next(err);
    }
});

export default router;
