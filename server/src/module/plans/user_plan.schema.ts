import { pgTable, text, timestamp, index } from "drizzle-orm/pg-core";
import { createId } from "@paralleldrive/cuid2";
import { users } from "../auth/user.schema.js";
import { plans } from "./plan.schema.js";

// A plan someone has bought. A row is added when a payment goes through (the Cashfree webhook, later); nothing is added
// for the free plan, which is what a person has whenever they have no active row.
export const userPlans = pgTable(
    "user_plans",
    {
        id: text("id").primaryKey().$defaultFn(() => createId()),
        userId: text("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
        planId: text("plan_id").references(() => plans.id).notNull(),

        // "active" while the plan can be used. Buying another plan does not change this one: purchases stack, each with its
        // own end date. Later: "expired" or "cancelled".
        status: text("status").default("active").notNull(),
        startsAt: timestamp("starts_at").defaultNow().notNull(),
        // Null means it never expires.
        expiresAt: timestamp("expires_at"),

        // Which payment provider took the money and its reference for the payment, so a payment can be traced.
        paymentProvider: text("payment_provider"),
        paymentReference: text("payment_reference"),

        createdAt: timestamp("created_at").defaultNow().notNull(),
    },
    (table) => [index("user_plans_user_idx").on(table.userId)]
);

export type UserPlan = typeof userPlans.$inferSelect;
