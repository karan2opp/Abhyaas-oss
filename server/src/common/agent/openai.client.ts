import dotenv from "dotenv";
import { env } from "../../env.js";
import { currentAiUserId } from "./ai_context.js";
import { getUserOpenAiKey } from "../../module/ai_keys/ai_key.service.js";
import { recordAiUsage, type RawUsage } from "../../module/ai_usage/ai_usage.service.js";

dotenv.config();

let openaiClient: any = null;
let mistralClient: any = null;

// One client per person (bring your own key), reused while their key stays the same.
const userClients = new Map<string, { apiKey: string; client: any }>();
const MAX_USER_CLIENTS = 500;

const getOpenAI = async () => {
    // "byok": the call is billed to the key of the person it is for. The server's own OPENAI_API_KEY is never used here, so
    // a call that has no key stops with a readable error instead of quietly running on your account.
    if (env.AI_KEY_MODE === "byok") {
        const userId = currentAiUserId();
        if (!userId) throw new Error("An AI call was made with no account to bill it to (a code path is missing runAsAiUser / bindAiUser).");
        const apiKey = await getUserOpenAiKey(userId);
        const cached = userClients.get(userId);
        if (cached && cached.apiKey === apiKey) return cached.client;

        const openai = (await import("openai")).default;
        const client = new openai.OpenAI({ apiKey });
        if (userClients.size >= MAX_USER_CLIENTS) userClients.delete(userClients.keys().next().value as string);
        userClients.set(userId, { apiKey, client });
        return client;
    }

    if (openaiClient) return openaiClient;
    const API_KEY = process.env.OPENAI_API_KEY;
    if (!API_KEY) {
        throw new Error("OPENAI_API_KEY is not set in the environment variables.");
    }
    const openai = (await import("openai")).default;
    openaiClient = new openai.OpenAI({ apiKey: API_KEY });
    return openaiClient;
};

const getMistral = async () => {
    if (mistralClient) return mistralClient;
    const API_KEY = process.env.MISTRAL_API_KEY;
    if (!API_KEY) {
        throw new Error("MISTRAL_API_KEY is not set in the environment variables.");
    }
    const openai = (await import("openai")).default;
    mistralClient = new openai.OpenAI({
        apiKey: API_KEY,
        baseURL: "https://api.mistral.ai/v1",
    });
    return mistralClient;
};

// Reasoning models from gpt-5.1 on (e.g. gpt-5.6-luna) refuse function tools
// on /v1/chat/completions unless reasoning is turned off. Other models
// (gpt-4.1-mini, Mistral) reject the parameter itself, so it's only sent where
// it applies. Spread this into every chat.completions call that passes tools.
export const toolCallParams = (model: string): { reasoning_effort?: "none" } =>
    /^gpt-5\.\d/i.test(model) ? { reasoning_effort: "none" } : {};

// ── AI usage log ──────────────────────────────────────────────────────────────────────────────────────────────────────
// Every AI call in the app is made on a client from getClientForModel, so the client is wrapped here: each call that
// goes through it is written to the usage log (tokens, cost, who it was for) without any call site having to do it.

/** Wraps the function at `path` (e.g. ["chat", "completions", "create"]) inside `obj`, leaving everything else untouched. */
const wrapAt = (obj: any, path: string[], wrap: (call: (...args: any[]) => any) => (...args: any[]) => any): any =>
    new Proxy(obj, {
        get(target, prop) {
            const value = Reflect.get(target, prop);
            if (prop === path[0]) {
                if (path.length > 1) return wrapAt(value, path.slice(1), wrap);
                return typeof value === "function" ? wrap(value.bind(target)) : value;
            }
            return typeof value === "function" ? value.bind(target) : value;
        },
    });

// Streamed replies only report their usage when asked to, in the last chunk. The chunks are passed on unchanged.
async function* watchStream(stream: AsyncIterable<any>, finish: (usage: RawUsage | undefined, error?: unknown) => void) {
    let usage: RawUsage | undefined;
    try {
        for await (const chunk of stream) {
            if (chunk?.usage) usage = chunk.usage;
            yield chunk;
        }
        finish(usage);
    } catch (err) {
        finish(usage, err);
        throw err;
    }
}

export const withUsageLog = (client: any, model: string, purpose: string) => {
    const track = (call: (...args: any[]) => any) => (params: any, ...rest: any[]) => {
        const started = Date.now();
        const streaming = params?.stream === true;
        const sent = streaming ? { ...params, stream_options: { include_usage: true, ...(params.stream_options ?? {}) } } : params;
        const log = (usage: RawUsage | undefined, error?: unknown) =>
            void recordAiUsage({
                model: params?.model ?? model,
                purpose,
                usage,
                success: !error,
                error: error ? (error instanceof Error ? error.message : String(error)) : undefined,
                durationMs: Date.now() - started,
            });
        return Promise.resolve(call(sent, ...rest)).then(
            (result: any) => (streaming ? watchStream(result, log) : (log(result?.usage), result)),
            (error: unknown) => {
                log(undefined, error);
                throw error;
            }
        );
    };
    let wrapped = wrapAt(client, ["chat", "completions", "create"], track);
    wrapped = wrapAt(wrapped, ["embeddings", "create"], track);
    wrapped = wrapAt(wrapped, ["audio", "transcriptions", "create"], track);
    return wrapped;
};

/**
 * The client for a model. `purpose` says what the call is for ("question_generation", "grading", ...); it is written to the
 * usage log with the tokens and cost of every call made on the returned client.
 */
export const getClientForModel = async (model: string, purpose = "other") => {
    const name = model.toLowerCase();
    // "ministral" (Mistral's small-model family, e.g. ministral-14b-2512)
    // does NOT contain "mistral" as a substring — check both explicitly.
    const client = name.includes("mistral") || name.includes("ministral") ? await getMistral() : await getOpenAI();
    return withUsageLog(client, model, purpose);
};
