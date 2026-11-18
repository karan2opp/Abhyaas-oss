import { env } from "../../env.js";

// Retrying AI calls with growing waits ("exponential backoff"): wait about 2s, then 4s, then 8s between attempts, with
// a little randomness so parallel calls that failed together don't all come back at the same moment and hit the rate
// limit again. When the provider says how long to wait (it does on rate limits), that wait is used instead.
//
// Callers turn the OpenAI library's own retries off for these calls ({ maxRetries: 0 }), so this is the only retrying
// and one failure can't multiply into many attempts.

/** Thrown by a caller when the AI answered, but the answer is unusable (unreadable, or failed a check). Always retried. */
export class BadAiReplyError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "BadAiReplyError";
    }
}

// Errors that can't change on a second try: a wrong key, no access, a malformed request.
const NOT_RETRYABLE_STATUS = new Set([400, 401, 403, 404, 422]);

function isRetryable(err: any): boolean {
    if (err instanceof BadAiReplyError) return true;
    // An unreadable or wrongly shaped reply (JSON.parse / zod) is worth asking again.
    if (err instanceof SyntaxError || err?.name === "ZodError") return true;
    const status: number | undefined = typeof err?.status === "number" ? err.status : undefined;
    if (status === undefined) return true; // dropped connection, timeout
    return !NOT_RETRYABLE_STATUS.has(status);
}

// How long the provider asked us to wait, in ms, if it said.
function retryAfterMs(err: any): number | null {
    const headers = err?.headers;
    const raw = typeof headers?.get === "function" ? headers.get("retry-after") : headers?.["retry-after"];
    const seconds = Number(raw);
    return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, 60_000) : null;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs one AI call, retrying it when it fails in a way that might succeed next time. `label` names the call in the
 * logs. The last error is thrown once the attempts run out, or straight away when it isn't worth retrying.
 */
export async function withAiRetry<T>(label: string, call: (attempt: number) => Promise<T>): Promise<T> {
    const attempts = env.AI_RETRY_ATTEMPTS;
    for (let attempt = 1; ; attempt++) {
        try {
            return await call(attempt);
        } catch (err: any) {
            if (attempt >= attempts || !isRetryable(err)) throw err;
            const backoff = env.AI_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
            const wait = retryAfterMs(err) ?? Math.round(backoff * (0.8 + Math.random() * 0.4));
            console.warn(`[ai-retry] ${label}: attempt ${attempt} of ${attempts} failed (${err?.status ?? err?.name ?? "error"}: ${String(err?.message ?? err).slice(0, 160)}) — retrying in ${wait}ms`);
            await sleep(wait);
        }
    }
}
