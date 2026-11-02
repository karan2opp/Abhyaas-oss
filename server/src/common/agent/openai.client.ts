import dotenv from "dotenv";

dotenv.config();

let openaiClient: any = null;
let mistralClient: any = null;

const getOpenAI = async () => {
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
