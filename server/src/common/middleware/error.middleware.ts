import type { Request, Response, NextFunction } from "express";
import { ApiError } from "../utils/ApiError.js";
import { ZodError } from "zod";
import fs from "fs";
import { asAiKeyProblem } from "../agent/ai_errors.js";
import { rememberRejectedKey } from "../../module/ai_keys/ai_key.service.js";

const errorHandler = (err: unknown, req: Request, res: Response, next: NextFunction) => {
    // already formatted ApiError
    if (err instanceof ApiError) {
        return res.status(err.statusCode).json({
            success: false,
            message: err.message,
            ...(err.code ? { code: err.code } : {}),
        });
    }

    // OpenAI turned down the person's own key (rejected, no credit, or no access to the model): say what to do about it,
    // instead of passing OpenAI's raw message on as a server error.
    const keyProblem = asAiKeyProblem(err);
    if (keyProblem) {
        if (keyProblem.code === "AI_KEY_INVALID") void rememberRejectedKey();
        return res.status(keyProblem.statusCode).json({ success: false, message: keyProblem.message, code: keyProblem.code });
    }

    // Zod validation error (fallback if validate middleware misses something)
    if (err instanceof ZodError) {
        return res.status(400).json({
            success: false,
            message: err.issues.map(e => e.message).join(", "),
        });
    }

    // JWT errors
    if (err instanceof Error) {
        if (err.name === "JsonWebTokenError") {
            return res.status(401).json({
                success: false,
                message: "Invalid token",
            });
        }
        if (err.name === "TokenExpiredError") {
            return res.status(401).json({
                success: false,
                message: "Token expired, please login again",
            });
        }
    }

    // unknown/unhandled errors
    console.error("Unhandled error:", err);
    try {
        fs.appendFileSync("error.log", new Date().toISOString() + " " + String(err instanceof Error ? err.stack : err) + "\n");
    } catch (e) {}
    
    // The details (a failed database query, a stack trace) stay in the server log. The person only gets a short message.
    return res.status(500).json({
        success: false,
        message: "Something went wrong on our side. Please try again in a moment.",
    });
};

export default errorHandler;