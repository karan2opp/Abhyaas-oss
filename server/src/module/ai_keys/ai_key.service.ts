import { eq } from "drizzle-orm";
import db from "../../common/db/index.js";
import { env } from "../../env.js";
import { ApiError } from "../../common/utils/ApiError.js";
import { encryptSecret, decryptSecret } from "../../common/utils/secretbox.js";
import { currentAiUserId } from "../../common/agent/ai_context.js";
import { aiKeyInvalidError, aiKeyRequiredError, asAiKeyProblem } from "../../common/agent/ai_errors.js";
import { userAiKeys } from "./ai_key.schema.js";

// OpenAI keys look like "sk-..." or "sk-proj-..." (letters, digits, "-" and "_").
const KEY_FORMAT = /^sk-[A-Za-z0-9_-]{20,}$/;

type KeyCheck = { ok: true } | { ok: false; message: string };

/**
 * Checks a key with one tiny real request (a few tokens, a tiny fraction of a cent). That proves the key is real, can use
 * the model the app needs, and has credit, which listing models would not. Sent straight to OpenAI with fetch so the key
 * only ever goes to OpenAI.
 */
async function checkOpenAiKey(apiKey: string): Promise<KeyCheck> {
    let res: Response;
    try {
        res = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({ model: env.GUARDRAIL_MODEL, messages: [{ role: "user", content: "ping" }], max_completion_tokens: 16 }),
            signal: AbortSignal.timeout(20_000),
        });
    } catch {
        return { ok: false, message: "Couldn't reach OpenAI to check the key. Please try again in a moment." };
    }
    if (res.ok) return { ok: true };

    const body: any = await res.json().catch(() => ({}));
    const code = String(body?.error?.code ?? "");
    if (res.status === 401) return { ok: false, message: "OpenAI says this key isn't valid. Check that you copied the whole key." };
    if (res.status === 429 && code === "insufficient_quota") {
        return { ok: false, message: "This key is valid, but its OpenAI account has no credit. Add credit in your OpenAI billing settings, then try again." };
    }
    if (res.status === 404 || res.status === 403) {
        return { ok: false, message: `This key can't use the model ${env.GUARDRAIL_MODEL}. Check that your OpenAI account has access to it.` };
    }
    return { ok: false, message: "OpenAI couldn't confirm the key right now. Please try again in a moment." };
}

export async function saveAiKey(userId: string, rawKey: string) {
    const apiKey = rawKey.trim();
    if (!KEY_FORMAT.test(apiKey)) throw ApiError.badRequest("That doesn't look like an OpenAI API key. It should start with sk-.");

    const check = await checkOpenAiKey(apiKey);
    if (!check.ok) throw ApiError.badRequest(check.message);

    const now = new Date();
    const values = { encryptedKey: encryptSecret(apiKey), last4: apiKey.slice(-4), status: "valid", lastCheckedAt: now, updatedAt: now };
    await db
        .insert(userAiKeys)
        .values({ userId, provider: "openai", ...values })
        .onConflictDoUpdate({ target: userAiKeys.userId, set: values });
    keyCache.delete(userId);
    return getAiKeyStatus(userId);
}

/** What the website may know about a person's key: that there is one, its last four characters and whether it works. */
export async function getAiKeyStatus(userId: string) {
    const [row] = await db.select().from(userAiKeys).where(eq(userAiKeys.userId, userId));
    return {
        mode: env.AI_KEY_MODE,
        hasKey: Boolean(row),
        provider: row?.provider ?? null,
        last4: row?.last4 ?? null,
        status: (row?.status ?? null) as "valid" | "invalid" | null,
        updatedAt: row?.updatedAt ?? null,
    };
}

export async function deleteAiKey(userId: string) {
    await db.delete(userAiKeys).where(eq(userAiKeys.userId, userId));
    keyCache.delete(userId);
}

/** Marks a key as rejected, after OpenAI itself turned it down. It stays that way until the person saves a new one. */
export async function markAiKeyInvalid(userId: string) {
    await db.update(userAiKeys).set({ status: "invalid", lastCheckedAt: new Date(), updatedAt: new Date() }).where(eq(userAiKeys.userId, userId));
    keyCache.delete(userId);
}

// The decrypted key is kept in memory for a short while so a burst of AI calls doesn't hit the database every time.
const KEY_CACHE_MS = 60_000;
const keyCache = new Map<string, { apiKey: string; expires: number }>();

/**
 * The person's OpenAI key, ready to use. Throws a readable "add your key" or "your key was rejected" error when there is
 * none to use, so the AI call never starts (and never falls back to the server's own key).
 */
export async function getUserOpenAiKey(userId: string): Promise<string> {
    const hit = keyCache.get(userId);
    if (hit && hit.expires > Date.now()) return hit.apiKey;

    const [row] = await db.select().from(userAiKeys).where(eq(userAiKeys.userId, userId));
    if (!row) throw aiKeyRequiredError();
    if (row.status !== "valid") throw aiKeyInvalidError();

    let apiKey: string;
    try {
        apiKey = decryptSecret(row.encryptedKey);
    } catch (err) {
        console.error("[AI key] could not decrypt a saved key for", userId, err instanceof Error ? err.message : err);
        throw ApiError.internal("Your saved key couldn't be read. Please add it again in Settings → AI key.");
    }
    keyCache.set(userId, { apiKey, expires: Date.now() + KEY_CACHE_MS });
    return apiKey;
}

/** Whether AI work for this person can go ahead: always in "server" mode, otherwise only with a working key of their own. */
export async function hasUsableAiKey(userId: string): Promise<boolean> {
    if (env.AI_KEY_MODE === "server") return true;
    const [row] = await db.select({ status: userAiKeys.status }).from(userAiKeys).where(eq(userAiKeys.userId, userId));
    return row?.status === "valid";
}

/** After OpenAI rejected the key of the person the current AI call is for: remember it, so AI features stop until they add a new one. */
export async function rememberRejectedKey(): Promise<void> {
    const userId = currentAiUserId();
    if (userId) await markAiKeyInvalid(userId).catch(() => undefined);
}

/**
 * Turns a failure from OpenAI into a readable key problem when that is what it is (a rejected key, no credit, no model
 * access), and in the rejected-key case remembers it. Returns null when the error is about something else.
 */
export async function toAiKeyApiError(err: unknown): Promise<ApiError | null> {
    const problem = asAiKeyProblem(err);
    if (problem?.code === "AI_KEY_INVALID") await rememberRejectedKey();
    return problem;
}
