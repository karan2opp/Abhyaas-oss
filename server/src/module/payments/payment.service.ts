import { and, eq } from "drizzle-orm";
import db from "../../common/db/index.js";
import { ApiError } from "../../common/utils/ApiError.js";
import { env } from "../../env.js";
import { users } from "../auth/user.schema.js";
import { plans } from "../plans/plan.schema.js";
import { userPlans } from "../plans/user_plan.schema.js";
import { paymentOrders, type PaymentOrder } from "./payment_order.schema.js";
import {
    createCashfreeOrder,
    getCashfreeOrder,
    getCashfreePayments,
    isCashfreeConfigured,
    verifyWebhookSignature,
} from "./cashfree.client.js";

const PHONE = /^\d{10}$/;
const DAY_MS = 86_400_000;

// The website addresses allowed to talk to this server (FRONTEND_URL, comma separated). Cashfree sends the person back
// to one of them after paying, so a phone on the LAN address comes back to the LAN address.
const frontendUrls = () =>
    (process.env.FRONTEND_URL || "http://localhost:3000")
        .split(",")
        .map((url) => url.trim().replace(/\/$/, ""))
        .filter(Boolean);

const returnBaseFor = (origin?: string) => {
    const allowed = frontendUrls();
    const clean = origin?.replace(/\/$/, "");
    return clean && allowed.includes(clean) ? clean : allowed[0]!;
};

/**
 * Starts buying a plan: records the order, asks Cashfree to create it, and returns the session the browser uses to open
 * Cashfree's payment page. Nothing is granted here. A plan is only granted once Cashfree confirms the payment (the webhook).
 */
export async function createOrder(input: { userId: string; planId: string; phone?: string | undefined; origin?: string | undefined }) {
    if (!isCashfreeConfigured()) throw new ApiError(503, "Online payments are not set up yet.");

    const [plan] = await db.select().from(plans).where(eq(plans.id, input.planId));
    if (!plan || !plan.isPublic || plan.isContactOnly || !plan.pricePaise || plan.pricePaise <= 0) {
        throw ApiError.badRequest("This plan can't be bought online.");
    }

    const [user] = await db.select().from(users).where(eq(users.id, input.userId));
    if (!user) throw ApiError.notFound("User not found");

    // Cashfree needs a 10 digit phone number for the payer. Use the one on the account, or save the one just entered.
    let phone = PHONE.test((user.phone ?? "").trim()) ? (user.phone as string).trim() : undefined;
    if (!phone && input.phone && PHONE.test(input.phone)) {
        phone = input.phone;
        await db.update(users).set({ phone, updatedAt: new Date() }).where(eq(users.id, user.id));
    }
    if (!phone) throw ApiError.badRequest("Please enter a 10-digit phone number to continue.");

    const [order] = await db
        .insert(paymentOrders)
        .values({ userId: user.id, planId: plan.id, amountPaise: plan.pricePaise, currency: plan.currency })
        .returning();
    if (!order) throw ApiError.internal("Could not start the payment");

    try {
        const cf = await createCashfreeOrder({
            order_id: order.id,
            order_amount: plan.pricePaise / 100,
            order_currency: plan.currency,
            order_note: `${plan.name} plan`,
            customer_details: { customer_id: user.id, customer_phone: phone, customer_email: user.email, customer_name: user.name },
            order_meta: {
                return_url: `${returnBaseFor(input.origin)}/payment/status?order_id={order_id}`,
                ...(env.CASHFREE_WEBHOOK_URL ? { notify_url: env.CASHFREE_WEBHOOK_URL } : {}),
            },
        });
        await db.update(paymentOrders).set({ cashfreeOrderId: String(cf.cf_order_id) }).where(eq(paymentOrders.id, order.id));
        return { orderId: order.id, paymentSessionId: cf.payment_session_id, environment: env.CASHFREE_ENV };
    } catch (err) {
        await db.update(paymentOrders).set({ status: "failed" }).where(eq(paymentOrders.id, order.id));
        throw err;
    }
}

const getOrder = async (orderId: string) => (await db.select().from(paymentOrders).where(eq(paymentOrders.id, orderId)))[0];

// The Cashfree reference of the successful payment on an order, for tracing. Missing it is not a reason to refuse the plan.
async function successfulPaymentId(orderId: string): Promise<string | undefined> {
    try {
        const payments = await getCashfreePayments(orderId);
        const ok = payments.find((p) => p.payment_status === "SUCCESS");
        return ok ? String(ok.cf_payment_id) : undefined;
    } catch {
        return undefined;
    }
}

/**
 * Turns a paid order into a plan the person can use. Safe to call any number of times, even at the same moment (Cashfree
 * retries webhooks, and the return page can ask too): the first caller to flip the order to "paid" does the work and
 * everyone else finds it already done.
 */
async function grantPlan(order: PaymentOrder, paymentId: string | undefined) {
    await db.transaction(async (tx) => {
        const [claimed] = await tx
            .update(paymentOrders)
            .set({ status: "paid", paidAt: new Date(), cashfreePaymentId: paymentId ?? null })
            .where(and(eq(paymentOrders.id, order.id), eq(paymentOrders.status, "created")))
            .returning();
        if (!claimed) return;

        const [plan] = await tx.select().from(plans).where(eq(plans.id, order.planId));
        const now = new Date();
        const expiresAt = plan?.durationDays ? new Date(now.getTime() + plan.durationDays * DAY_MS) : null;

        // A purchase never replaces an earlier one: each keeps its own limits and its own end date, and they are used up in
        // order (see quota.service.ts). So this only adds a row.
        const [purchase] = await tx
            .insert(userPlans)
            .values({
                userId: order.userId,
                planId: order.planId,
                status: "active",
                startsAt: now,
                expiresAt,
                paymentProvider: "cashfree",
                paymentReference: paymentId ?? order.cashfreeOrderId ?? order.id,
            })
            .returning();
        if (purchase) await tx.update(paymentOrders).set({ userPlanId: purchase.id }).where(eq(paymentOrders.id, order.id));
    });
}

/**
 * Settles one order: asks Cashfree for its real status (so a request can't just claim a payment happened) and, if it is
 * paid for the right amount, grants the plan. Returns the order as it now stands, or null if there is no such order.
 */
export async function settleOrder(orderId: string): Promise<PaymentOrder | null> {
    const order = await getOrder(orderId);
    if (!order) return null;
    if (order.status !== "created") return order;

    const cf = await getCashfreeOrder(order.id);

    if (cf.order_status === "PAID") {
        if (Math.round(Number(cf.order_amount) * 100) !== order.amountPaise) {
            console.error("[Payments] amount mismatch for", order.id, "expected", order.amountPaise, "paise, Cashfree says", cf.order_amount);
            await db.update(paymentOrders).set({ status: "failed" }).where(and(eq(paymentOrders.id, order.id), eq(paymentOrders.status, "created")));
        } else {
            await grantPlan(order, await successfulPaymentId(order.id));
        }
    } else if (["EXPIRED", "TERMINATED", "TERMINATION_REQUESTED"].includes(cf.order_status)) {
        await db.update(paymentOrders).set({ status: "failed" }).where(and(eq(paymentOrders.id, order.id), eq(paymentOrders.status, "created")));
    }
    // Any other status (ACTIVE) means the person hasn't finished paying; the order stays open.

    return (await getOrder(orderId)) ?? null;
}

/** The order for the person asking, or a not-found error if it isn't theirs. */
export async function getOwnOrder(userId: string, orderId: string): Promise<PaymentOrder> {
    const order = await getOrder(orderId);
    if (!order || order.userId !== userId) throw ApiError.notFound("Order not found");
    return order;
}

/**
 * Handles a call from Cashfree's webhook. Only a correctly signed request is believed; even then the order is settled by
 * asking Cashfree for its status, so the webhook is the trigger and Cashfree's own record is the proof.
 * Returns false when the signature is wrong.
 */
export async function handleWebhook(rawBody: Buffer, signature: string | undefined, timestamp: string | undefined): Promise<boolean> {
    if (!verifyWebhookSignature(rawBody, signature, timestamp)) return false;

    let payload: any;
    try {
        payload = JSON.parse(rawBody.toString("utf8"));
    } catch {
        return true; // signed but not JSON: nothing to do
    }

    const type = String(payload?.type ?? "");
    const orderId = payload?.data?.order?.order_id;
    // Only a successful payment changes anything. Failed or abandoned attempts leave the order open: the person can retry.
    if (typeof orderId === "string" && type.includes("SUCCESS")) await settleOrder(orderId);
    return true;
}
