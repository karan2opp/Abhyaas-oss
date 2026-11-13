import { pgTable, text, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";

// What each plan includes. Limits live here, not in code, so a number can be changed (or a plan added) with one UPDATE
// or INSERT and no deploy. A null limit means "no fixed limit" (used by the contact-us plan, whose limits are agreed
// with the customer one by one).
export const plans = pgTable("plans", {
    // A short readable id, for example "free" or "plus". Other tables refer to a plan by this.
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description").default("").notNull(),

    // The price in paise (₹149 is 14900), so no decimals are needed. 0 for the free plan; null when there is no fixed price.
    pricePaise: integer("price_paise"),
    currency: text("currency").default("INR").notNull(),
    // How long a purchase lasts. Null means it doesn't expire (the free allowance).
    durationDays: integer("duration_days"),

    // AI-written questions the plan allows, and student answers the AI may grade. Null: no fixed limit.
    questionGenerationLimit: integer("question_generation_limit"),
    aiGradingLimit: integer("ai_grading_limit"),

    // Short lines shown on the pricing page.
    features: jsonb("features").$type<string[]>().default([]).notNull(),

    // A plan that is sold by talking to the team instead of paying online.
    isContactOnly: boolean("is_contact_only").default(false).notNull(),
    // Only public plans are listed on the pricing page; the rest can still be given to a customer by hand.
    isPublic: boolean("is_public").default(true).notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type Plan = typeof plans.$inferSelect;
