import { pgTable, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { createId } from "@paralleldrive/cuid2";
import { users } from "../auth/user.schema.js";
import { plans } from "../plans/plan.schema.js";
import { userPlans } from "../plans/user_plan.schema.js";

// One attempt to buy a plan. It is written before the person is sent to Cashfree and updated when the payment is
// confirmed, so a payment can always be traced and the same payment can never be counted twice.
export const paymentOrders = pgTable(
    "payment_orders",
    {
        // Also the order id sent to Cashfree: "ord_" and letters or digits only, well inside Cashfree's 50 character limit.
        id: text("id").primaryKey().$defaultFn(() => `ord_${createId()}`),
        userId: text("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
        planId: text("plan_id").references(() => plans.id).notNull(),

        // The price at the time of buying, in paise, so a later price change doesn't rewrite history.
        amountPaise: integer("amount_paise").notNull(),
        currency: text("currency").default("INR").notNull(),

        // "created" until Cashfree confirms, then "paid" or "failed".
        status: text("status").default("created").notNull(),

        // Cashfree's own references.
        cashfreeOrderId: text("cashfree_order_id"),
        cashfreePaymentId: text("cashfree_payment_id"),

        // The plan purchase this payment created (null until it is paid).
        userPlanId: text("user_plan_id").references(() => userPlans.id),

        createdAt: timestamp("created_at").defaultNow().notNull(),
        paidAt: timestamp("paid_at"),
    },
    (table) => [index("payment_orders_user_idx").on(table.userId)]
);

export type PaymentOrder = typeof paymentOrders.$inferSelect;
