import { pgTable, text, integer, doublePrecision, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { createId } from "@paralleldrive/cuid2";

// One row per call to an AI model: who it was for, what it was for, and exactly what it used and cost. Rows are never
// edited. The ids are plain text with no links to other tables, so the history stays even if an exam or organisation is
// deleted later.
export const aiUsageLog = pgTable(
  "ai_usage_log",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    organisationId: text("organisation_id"),
    userId: text("user_id"),
    examId: text("exam_id"),
    assignmentId: text("assignment_id"),
    // What the call was for: "question_generation", "rubric", "grading", ... (set where the client is made).
    purpose: text("purpose").notNull(),
    model: text("model").notNull(),
    // Input tokens charged at the full rate (those not served from OpenAI's cache).
    inputTokens: integer("input_tokens").default(0).notNull(),
    cachedInputTokens: integer("cached_input_tokens").default(0).notNull(),
    // Everything the model wrote, including its hidden reasoning (billed as output).
    outputTokens: integer("output_tokens").default(0).notNull(),
    reasoningTokens: integer("reasoning_tokens").default(0).notNull(),
    // Cost in US dollars, worked out from model_prices when the call was made.
    costUsd: doublePrecision("cost_usd").default(0).notNull(),
    // True when the model had no price in model_prices, so costUsd is 0 for lack of a price, not because it was free.
    priceMissing: boolean("price_missing").default(false).notNull(),
    success: boolean("success").default(true).notNull(),
    error: text("error"),
    durationMs: integer("duration_ms"),
  },
  (t) => [
    index("ai_usage_log_org_created_idx").on(t.organisationId, t.createdAt),
    index("ai_usage_log_exam_idx").on(t.examId),
    index("ai_usage_log_assignment_idx").on(t.assignmentId),
  ]
);

// What each model costs, in US dollars per million tokens. Edit a row when OpenAI changes a price.
export const modelPrices = pgTable("model_prices", {
  model: text("model").primaryKey(),
  inputPerMillion: doublePrecision("input_per_million").notNull(),
  cachedInputPerMillion: doublePrecision("cached_input_per_million").notNull(),
  outputPerMillion: doublePrecision("output_per_million").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type AiUsageLog = typeof aiUsageLog.$inferSelect;
export type NewAiUsageLog = typeof aiUsageLog.$inferInsert;
export type ModelPrice = typeof modelPrices.$inferSelect;
