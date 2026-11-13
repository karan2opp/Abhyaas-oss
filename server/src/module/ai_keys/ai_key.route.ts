import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../common/middleware/auth.middleware.js";
import { ApiError } from "../../common/utils/ApiError.js";
import { deleteAiKey, getAiKeyStatus, saveAiKey } from "./ai_key.service.js";

const router = Router();

const saveSchema = z.object({ apiKey: z.string().min(1, "Paste your OpenAI API key") });

// Saving a key sends it to OpenAI to be checked, so a person may only try a few keys every few minutes. Otherwise this
// could be used to test lists of stolen keys against OpenAI.
const MAX_ATTEMPTS = 8;
const WINDOW_MS = 10 * 60 * 1000;
const attempts = new Map<string, number[]>();
const allowAttempt = (userId: string) => {
    const now = Date.now();
    const recent = (attempts.get(userId) ?? []).filter((t) => now - t < WINDOW_MS);
    if (recent.length >= MAX_ATTEMPTS) {
        attempts.set(userId, recent);
        return false;
    }
    recent.push(now);
    attempts.set(userId, recent);
    return true;
};

// Whether the signed-in person has a key and whether it works. Never returns the key.
router.get("/", authenticate, async (req, res, next) => {
    try {
        res.json({ success: true, data: await getAiKeyStatus(req.user!.id) });
    } catch (error) {
        next(error);
    }
});

// Checks the key with OpenAI and, if it works, saves it (encrypted), replacing any earlier one.
router.put("/", authenticate, async (req, res, next) => {
    try {
        const { apiKey } = saveSchema.parse(req.body);
        if (!allowAttempt(req.user!.id)) throw new ApiError(429, "Too many attempts. Please wait a few minutes and try again.");
        res.json({ success: true, data: await saveAiKey(req.user!.id, apiKey) });
    } catch (error) {
        next(error);
    }
});

router.delete("/", authenticate, async (req, res, next) => {
    try {
        await deleteAiKey(req.user!.id);
        res.json({ success: true, data: await getAiKeyStatus(req.user!.id) });
    } catch (error) {
        next(error);
    }
});

export default router;
