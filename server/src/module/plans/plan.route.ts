import { Router } from "express";
import { asc, eq } from "drizzle-orm";
import db from "../../common/db/index.js";
import { authenticate } from "../../common/middleware/auth.middleware.js";
import { plans } from "./plan.schema.js";
import { getPlanUsage } from "./quota.service.js";

const router = Router();

// The plans for the pricing page. Open to everyone (no sign-in), and only the plans marked public.
router.get("/", async (_req, res, next) => {
    try {
        const rows = await db.select().from(plans).where(eq(plans.isPublic, true)).orderBy(asc(plans.sortOrder));
        res.json({ success: true, data: rows });
    } catch (error) {
        next(error);
    }
});

// The plan the signed-in person has right now, with how much of each limit they have used.
router.get("/me", authenticate, async (req, res, next) => {
    try {
        res.json({ success: true, data: await getPlanUsage(req.user!.id) });
    } catch (error) {
        next(error);
    }
});

export default router;
