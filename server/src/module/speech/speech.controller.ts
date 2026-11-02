import type { Request, Response, NextFunction } from "express";
import { toFile } from "openai";
import { ApiError } from "../../common/utils/ApiError.js";
import { getClientForModel } from "../../common/agent/openai.client.js";
import { env } from "../../env.js";

// Browsers record as webm/opus (Chrome, Edge, Firefox) or mp4 (Safari).
const ALLOWED_TYPE = /^audio\/(webm|ogg|mp4|mpeg|wav|x-m4a)(;|$)/;

const extensionFor = (mimetype: string) => (mimetype.includes("mp4") || mimetype.includes("m4a") ? "mp4" : mimetype.includes("ogg") ? "ogg" : mimetype.includes("wav") ? "wav" : mimetype.includes("mpeg") ? "mp3" : "webm");

/** Turns a short voice recording into text (speech-to-text). The caller puts the text in the message box; nothing is sent from here. */
export const transcribeHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        if (!req.file) throw ApiError.badRequest("A recording is required (field name: audio)");
        if (!ALLOWED_TYPE.test(req.file.mimetype)) throw ApiError.badRequest("Unsupported audio format");

        const client = await getClientForModel(env.TRANSCRIPTION_MODEL);
        const file = await toFile(req.file.buffer, `speech.${extensionFor(req.file.mimetype)}`, { type: req.file.mimetype });
        const result = await client.audio.transcriptions.create({ file, model: env.TRANSCRIPTION_MODEL });

        res.json({ success: true, data: { text: String(result.text ?? "").trim() } });
    } catch (err) {
        next(err);
    }
};
