import { ApiError } from "../utils/ApiError.js";

// Errors about a person's own AI key. They are HTTP 402 with a `code` the website can recognise, and a message the person
// can act on. Nothing here ever contains the key itself.

export const aiKeyRequiredError = () =>
    new ApiError(402, "Add your OpenAI API key in Settings → AI key to use AI features.", "AI_KEY_REQUIRED");

export const aiKeyInvalidError = () =>
    new ApiError(402, "OpenAI rejected your API key. Check it in Settings → AI key, or add a new one.", "AI_KEY_INVALID");

const aiKeyNoCreditError = () =>
    new ApiError(402, "Your OpenAI account has no credit left. Add credit in your OpenAI billing settings, then try again.", "AI_KEY_NO_CREDIT");

const aiModelUnavailableError = () =>
    new ApiError(
        402,
        "Your OpenAI key can't use the AI model this feature needs. Check that your OpenAI account has access to it (new accounts may need to add credit or be verified first).",
        "AI_MODEL_UNAVAILABLE"
    );

/**
 * Recognises an error that came back from OpenAI and is about the person's key, credit or model access, and turns it into
 * a message they can act on. Returns null for any other error (including OpenAI's busy or temporary errors, which are
 * worth retrying and aren't the person's fault).
 */
export function asAiKeyProblem(err: unknown): ApiError | null {
    // The OpenAI library's errors carry the HTTP status and the response headers; ordinary errors don't.
    const e = err as any;
    if (!(err instanceof Error) || typeof e.status !== "number" || e.headers === undefined) return null;

    const code = String(e.code ?? e.error?.code ?? "");
    if (e.status === 401) return aiKeyInvalidError();
    if (e.status === 429 && code === "insufficient_quota") return aiKeyNoCreditError();
    if ((e.status === 404 || e.status === 403) && (code === "model_not_found" || /model/i.test(String(e.message)))) return aiModelUnavailableError();
    return null;
}
