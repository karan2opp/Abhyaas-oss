import { pgTable, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { createId } from "@paralleldrive/cuid2";
import { users } from "../auth/user.schema.js";
import { userPlans } from "./user_plan.schema.js";

// One row each time something that costs AI money is used, charged to the person whose plan pays for it: the teacher who
// asked for the questions, or the teacher whose exam's answers were graded. A plan's limit is checked against the sum of
// these rows (see quota.service.ts).
export const usageEvents = pgTable(
    "usage_events",
    {
        id: text("id").primaryKey().$defaultFn(() => createId()),
        userId: text("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),

        // "question_generation" (AI-written questions) or "ai_grading" (student answers graded by AI).
        kind: text("kind").notNull(),
        quantity: integer("quantity").notNull(),

        // The purchase this was used under, so a bought pack is counted on its own. Null means the free plan.
        userPlanId: text("user_plan_id").references(() => userPlans.id, { onDelete: "set null" }),

        createdAt: timestamp("created_at").defaultNow().notNull(),
    },
    (table) => [index("usage_events_user_kind_idx").on(table.userId, table.kind)]
);
