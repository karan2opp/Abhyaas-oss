import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import type { Request } from "express";

// Limits on guessing exam join codes. Signing in, registering and email codes are handled by Clerk, which has its own
// protections. The counters are kept in the server's memory, so they start again when the server restarts.
//
// Schools and colleges often share one public IP address, so the join code is counted per signed-in student, never per IP.

const tooMany = (message: string) => ({ success: false, message });
const ipOf = (req: Request) => ipKeyGenerator(req.ip ?? "");

// Trying exam join codes. Only failed tries count, per signed-in student.
export const joinCodeLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 10,
    skipSuccessfulRequests: true,
    keyGenerator: (req) => req.user?.id ?? ipOf(req),
    message: tooMany("Too many wrong join codes. Please wait a minute and try again."),
    standardHeaders: true,
    legacyHeaders: false,
});
