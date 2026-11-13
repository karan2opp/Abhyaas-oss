import { and, asc, eq, gt, isNull, or, sql } from "drizzle-orm";
import db from "../../common/db/index.js";
import { plans } from "./plan.schema.js";
import { userPlans } from "./user_plan.schema.js";

/**
 * Every plan a person has bought that can be used right now, in the order they are used up: the one that runs out first
 * goes first (ties: the one bought first; a plan that never expires goes last). Buying another plan does not replace the
 * old one. Each purchase keeps its own start and end date and its own limits, and its unused part simply disappears when
 * its own end date passes. With none, the person is on the free plan, which is never stored as a purchase.
 */
export async function getActivePurchases(userId: string) {
    return db
        .select({ purchase: userPlans, plan: plans })
        .from(userPlans)
        .innerJoin(plans, eq(userPlans.planId, plans.id))
        .where(
            and(
                eq(userPlans.userId, userId),
                eq(userPlans.status, "active"),
                or(isNull(userPlans.expiresAt), gt(userPlans.expiresAt, new Date()))
            )
        )
        .orderBy(sql`${userPlans.expiresAt} asc nulls last`, asc(userPlans.startsAt));
}

/** The free plan, which everyone has when they have no active purchase. */
export async function getFreePlan() {
    const [free] = await db.select().from(plans).where(eq(plans.id, "free"));
    return free ?? null;
}
