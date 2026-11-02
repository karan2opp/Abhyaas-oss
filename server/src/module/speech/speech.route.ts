import { Router } from "express";
import multer from "multer";
import { rateLimit } from "express-rate-limit";
import { authenticate, authorize } from "../../common/middleware/auth.middleware.js";
import { transcribeHandler } from "./speech.controller.js";

const router = Router();

// A 60-second recording is well under 1 MB; anything near this limit isn't a voice message.
const audioUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 3 * 1024 * 1024 } });

// Every clip is billed by the minute, so one person can't send an endless stream of them.
const transcribeLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 15,
    keyGenerator: (req) => req.user!.id,
    message: { success: false, message: "Too many recordings in a short time. Please wait a moment." },
    standardHeaders: true,
    legacyHeaders: false,
});

router.post("/transcribe", authenticate, authorize("teacher"), transcribeLimiter, audioUpload.single("audio"), transcribeHandler);

export default router;
