import { eq } from "drizzle-orm";
import db from "../../common/db/index.js";
import { aiUsageLog, modelPrices, exams, assignments, type ModelPrice } from "../../common/db/schema.js";
import { currentUsageContext, type UsageContext } from "../../common/agent/usage_context.js";
import { currentAiUserId } from "../../common/agent/ai_context.js";

// What the usage log needs from an OpenAI reply. Chat replies report prompt_tokens (cached ones included) and
// completion_tokens (reasoning included); embeddings report only prompt_tokens; transcription may report nothing.
export interface RawUsage {
    prompt_tokens?: number | undefined;
    completion_tokens?: number | undefined;
    total_tokens?: number | undefined;
    prompt_tokens_details?: { cached_tokens?: number | undefined } | undefined;
    completion_tokens_details?: { reasoning_tokens?: number | undefined } | undefined;
    // Transcription models report input/output instead.
    input_tokens?: number | undefined;
    output_tokens?: number | undefined;
}

const PRICE_CACHE_MS = 60_000;
let priceCache: { at: number; byModel: Map<string, ModelPrice> } | null = null;

const loadPrices = async (): Promise<Map<string, ModelPrice>> => {
    if (priceCache && Date.now() - priceCache.at < PRICE_CACHE_MS) return priceCache.byModel;
    const rows = await db.select().from(modelPrices);
    priceCache = { at: Date.now(), byModel: new Map(rows.map((r) => [r.model.toLowerCase(), r])) };
    return priceCache.byModel;
};

/** Forget the cached prices (after editing model_prices, and in tests). */
export const clearPriceCache = () => {
    priceCache = null;
};

/** The tokens of a reply in the shape the log stores them, and what they cost at this model's price. */
export const costOf = (usage: RawUsage | undefined, price: ModelPrice | undefined) => {
    const promptTokens = usage?.prompt_tokens ?? usage?.input_tokens ?? 0;
    const cachedInputTokens = Math.min(promptTokens, usage?.prompt_tokens_details?.cached_tokens ?? 0);
    const inputTokens = promptTokens - cachedInputTokens;
    const outputTokens = usage?.completion_tokens ?? usage?.output_tokens ?? 0;
    const reasoningTokens = usage?.completion_tokens_details?.reasoning_tokens ?? 0;
    const costUsd = price
        ? (inputTokens * price.inputPerMillion + cachedInputTokens * price.cachedInputPerMillion + outputTokens * price.outputPerMillion) / 1_000_000
        : 0;
    return { inputTokens, cachedInputTokens, outputTokens, reasoningTokens, costUsd, priceMissing: !price && promptTokens + outputTokens > 0 };
};

export interface AiUsageEntry {
    model: string;
    purpose: string;
    usage?: RawUsage | undefined;
    success: boolean;
    error?: string | undefined;
    durationMs?: number | undefined;
    // Who it was for; falls back to the current context (see usage_context.ts).
    context?: UsageContext | undefined;
}

/**
 * Writes one row to the usage log. Never throws: a problem with the log must not fail the AI call it describes (the
 * teacher's questions or the student's grade), so a failure is only reported on the console.
 */
export const recordAiUsage = async (entry: AiUsageEntry): Promise<void> => {
    try {
        const prices = await loadPrices();
        const context = { ...currentUsageContext(), ...(entry.context ?? {}) };
        const counted = costOf(entry.usage, prices.get(entry.model.toLowerCase()));
        await db.insert(aiUsageLog).values({
            organisationId: context.organisationId ?? null,
            // Whose AI key the call ran on (see ai_context.ts) when nothing more specific was set.
            userId: context.userId ?? currentAiUserId() ?? null,
            examId: context.examId ?? null,
            assignmentId: context.assignmentId ?? null,
            purpose: entry.purpose,
            model: entry.model,
            ...counted,
            success: entry.success,
            error: entry.error ? entry.error.slice(0, 500) : null,
            durationMs: entry.durationMs ?? null,
        });
    } catch (err) {
        console.error("[AiUsage] Could not write the usage log:", err);
    }
};

/** The owner of an exam, for work done on its behalf (grading, writing grading guides). */
export const examUsageContext = async (examId: string): Promise<UsageContext> => {
    const [exam] = await db.select({ createdBy: exams.createdBy }).from(exams).where(eq(exams.id, examId));
    return exam ? { examId, userId: exam.createdBy } : { examId };
};

/** The owner of an assignment, for work done on its behalf (grading, writing grading guides). */
export const assignmentUsageContext = async (assignmentId: string): Promise<UsageContext> => {
    const [assignment] = await db.select({ createdBy: assignments.createdBy }).from(assignments).where(eq(assignments.id, assignmentId));
    return assignment ? { assignmentId, userId: assignment.createdBy } : { assignmentId };
};
