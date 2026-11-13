import crypto from "crypto";
import { env } from "../../env.js";
import { ApiError } from "../../common/utils/ApiError.js";

// A thin wrapper over Cashfree's REST API (Payment Gateway, "orders"). No SDK: three calls and a signature check.
const BASE_URL = env.CASHFREE_ENV === "production" ? "https://api.cashfree.com/pg" : "https://sandbox.cashfree.com/pg";
const API_VERSION = "2023-08-01";

export const isCashfreeConfigured = () => Boolean(env.CASHFREE_APP_ID && env.CASHFREE_SECRET_KEY);

export interface CashfreeOrder {
    cf_order_id: string | number;
    order_id: string;
    // In rupees, as a number (₹149 is 149).
    order_amount: number;
    order_currency: string;
    // ACTIVE (waiting for payment), PAID, EXPIRED, TERMINATED ...
    order_status: string;
    payment_session_id: string;
}

export interface CashfreePayment {
    cf_payment_id: string | number;
    // SUCCESS, FAILED, PENDING, USER_DROPPED ...
    payment_status: string;
}

async function request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
        res = await fetch(`${BASE_URL}${path}`, {
            method,
            headers: {
                "x-client-id": env.CASHFREE_APP_ID,
                "x-client-secret": env.CASHFREE_SECRET_KEY,
                "x-api-version": API_VERSION,
                "Content-Type": "application/json",
                Accept: "application/json",
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            signal: AbortSignal.timeout(15_000),
        });
    } catch (err) {
        console.error("[Cashfree] request failed:", method, path, err instanceof Error ? err.message : err);
        throw new ApiError(502, "The payment provider could not be reached. Please try again.");
    }

    const text = await res.text();
    let data: any = null;
    try {
        data = text ? JSON.parse(text) : null;
    } catch {
        // not JSON; handled below
    }

    if (!res.ok) {
        console.error("[Cashfree] error", res.status, method, path, text.slice(0, 300));
        throw new ApiError(502, data?.message ? `Payment provider: ${data.message}` : "The payment provider refused the request. Please try again.");
    }
    return data as T;
}

export function createCashfreeOrder(body: {
    order_id: string;
    order_amount: number;
    order_currency: string;
    order_note?: string;
    customer_details: { customer_id: string; customer_phone: string; customer_email?: string; customer_name?: string };
    order_meta: { return_url: string; notify_url?: string };
}) {
    return request<CashfreeOrder>("POST", "/orders", body);
}

export function getCashfreeOrder(orderId: string) {
    return request<CashfreeOrder>("GET", `/orders/${encodeURIComponent(orderId)}`);
}

export function getCashfreePayments(orderId: string) {
    return request<CashfreePayment[]>("GET", `/orders/${encodeURIComponent(orderId)}/payments`);
}

/**
 * Checks that a webhook really came from Cashfree. Cashfree signs the timestamp followed by the exact raw request body
 * with the account's secret key (HMAC SHA-256, base64) and sends the result in `x-webhook-signature`. It must be the raw
 * bytes: re-serialising the parsed JSON can change them and break the match.
 */
export function verifyWebhookSignature(rawBody: Buffer, signature: string | undefined, timestamp: string | undefined): boolean {
    if (!signature || !timestamp || !env.CASHFREE_SECRET_KEY) return false;
    const expected = crypto.createHmac("sha256", env.CASHFREE_SECRET_KEY).update(timestamp + rawBody.toString("utf8")).digest("base64");
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}
