import express, { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { authenticate } from "../../common/middleware/auth.middleware.js";
import { createOrder, getOwnOrder, handleWebhook, settleOrder } from "./payment.service.js";

const router = Router();

const createOrderSchema = z.object({
    planId: z.string().min(1, "Choose a plan"),
    phone: z.string().regex(/^\d{10}$/, "Phone must be 10 digits").optional(),
});

// Start buying a plan. Returns what the browser needs to open Cashfree's payment page.
router.post("/orders", authenticate, async (req, res, next) => {
    try {
        const body = createOrderSchema.parse(req.body);
        const data = await createOrder({ userId: req.user!.id, planId: body.planId, phone: body.phone, origin: req.headers.origin });
        res.status(201).json({ success: true, data });
    } catch (error) {
        next(error);
    }
});

// Where an order stands. The page people come back to after paying asks this until it says "paid" or "failed".
router.get("/orders/:orderId", authenticate, async (req, res, next) => {
    try {
        let order = await getOwnOrder(req.user!.id, String(req.params.orderId));
        if (order.status === "created") {
            // The webhook normally has made it "paid" by now. If it hasn't arrived (yet, or in local development where
            // Cashfree can't reach this machine), ask Cashfree directly. It goes through the same safe path as the webhook.
            try {
                order = (await settleOrder(order.id)) ?? order;
            } catch (err) {
                console.error("[Payments] could not check order", order.id, err instanceof Error ? err.message : err);
            }
        }
        res.json({ success: true, data: { orderId: order.id, status: order.status, planId: order.planId } });
    } catch (error) {
        next(error);
    }
});

// Cashfree's webhook. Mounted in app.ts before the JSON parser (see there): the signature covers the exact raw body.
export const paymentWebhook = [
    express.raw({ type: "*/*", limit: "1mb" }),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
            const ok = await handleWebhook(raw, req.header("x-webhook-signature"), req.header("x-webhook-timestamp"));
            if (!ok) {
                res.status(401).json({ success: false, message: "Invalid signature" });
                return;
            }
            res.status(200).json({ success: true });
        } catch (error) {
            // An error here makes Cashfree try the webhook again later, which is what we want for a temporary failure.
            next(error);
        }
    },
];

export default router;
