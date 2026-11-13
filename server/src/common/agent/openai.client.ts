import dotenv from "dotenv";
import { env } from "../../env.js";
import { currentAiUserId } from "./ai_context.js";
import { getUserOpenAiKey } from "../../module/ai_keys/ai_key.service.js";

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

export const getClientForModel = async (model: string) => {
    const name = model.toLowerCase();
    // "ministral" (Mistral's small-model family, e.g. ministral-14b-2512)
    // does NOT contain "mistral" as a substring — check both explicitly.
    if (name.includes("mistral") || name.includes("ministral")) {
        return getMistral();
    }
    return getOpenAI();
};
