import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import db from "../../common/db/index.js";
import { ApiError } from "../../common/utils/ApiError.js";
import { env } from "../../env.js";
import { getActivePurchases, getFreePlan } from "./plan.service.js";
import type { Plan } from "./plan.schema.js";
import { usageEvents } from "./usage.schema.js";

export type QuotaKind = "question_generation" | "ai_grading";

const LABELS: Record<QuotaKind, string> = {
    question_generation: "AI-written questions",
    ai_grading: "AI-graded answers",
};

export interface Quota {
    // How many the person's plans allow in total. Null means no fixed limit (the custom plan, whose limits are agreed with
    // the customer).
    limit: number | null;
    used: number;
    // How many are left. Null when there is no fixed limit.
    remaining: number | null;
    // The plans behind the numbers, for messages: "Basic", or "Basic + Pro" when the person has bought more than one.
    planName: string;
}

/** One bought plan's own allowance for one kind of usage. */
export interface PackQuota {
    userPlanId: string;
    plan: Plan;
    startsAt: Date;
    expiresAt: Date | null;
    limit: number | null;
    used: number;
    remaining: number | null;
}

const limitFor = (plan: Plan, kind: QuotaKind) => (kind === "question_generation" ? plan.questionGenerationLimit : plan.aiGradingLimit);

/**
 * The allowance of each plan the person can use right now, in the order they are used up (see getActivePurchases). Usage is
 * counted against the purchase it was used under, so every bought plan starts from zero and keeps its own count.
 */
export async function getPackQuotas(userId: string, kind: QuotaKind): Promise<PackQuota[]> {
    const purchases = await getActivePurchases(userId);
    if (purchases.length === 0) return [];

    const rows = await db
        .select({ userPlanId: usageEvents.userPlanId, used: sql<number>`coalesce(sum(${usageEvents.quantity}), 0)::int` })
        .from(usageEvents)
        .where(and(eq(usageEvents.userId, userId), eq(usageEvents.kind, kind), inArray(usageEvents.userPlanId, purchases.map((p) => p.purchase.id))))
        .groupBy(usageEvents.userPlanId);
    const usedBy = new Map(rows.map((r) => [r.userPlanId, r.used]));

    return purchases.map(({ purchase, plan }) => {
        const limit = limitFor(plan, kind);
        const used = usedBy.get(purchase.id) ?? 0;
        return {
            userPlanId: purchase.id,
            plan,
            startsAt: purchase.startsAt,
            expiresAt: purchase.expiresAt,
            limit,
            used,
            remaining: limit === null ? null : Math.max(0, limit - used),
        };
    });
}

/** What the free plan allows for one kind of usage. Its allowance is for the life of the account. */
async function getFreeQuota(userId: string, kind: QuotaKind): Promise<Quota> {
    const free = await getFreePlan();
    const limit = !free ? 0 : limitFor(free, kind);
    const [row] = await db
        .select({ used: sql<number>`coalesce(sum(${usageEvents.quantity}), 0)::int` })
        .from(usageEvents)
        .where(and(eq(usageEvents.userId, userId), eq(usageEvents.kind, kind), isNull(usageEvents.userPlanId)));
    const used = row?.used ?? 0;
    return { limit, used, remaining: limit === null ? null : Math.max(0, limit - used), planName: free?.name ?? "Free" };
}

/**
 * What a person's plans allow for one kind of usage, and how much of it they have used. Every plan they have bought and
 * that has not run out counts: the limits add up, and each plan's unused part is gone once its own end date passes. With
 * no bought plan they are on the free plan.
 */
export async function getQuota(userId: string, kind: QuotaKind): Promise<Quota> {
    const packs = await getPackQuotas(userId, kind);
    if (packs.length === 0) return getFreeQuota(userId, kind);

    const unlimited = packs.some((p) => p.limit === null);
    return {
        limit: unlimited ? null : packs.reduce((sum, p) => sum + (p.limit ?? 0), 0),
        used: packs.reduce((sum, p) => sum + p.used, 0),
        remaining: unlimited ? null : packs.reduce((sum, p) => sum + (p.remaining ?? 0), 0),
        planName: packs.map((p) => p.plan.name).join(" + "),
    };
}

/** How many of this kind are left, or null when there is no fixed limit (always, when people use their own OpenAI key). */
export async function remainingQuota(userId: string, kind: QuotaKind): Promise<number | null> {
    if (env.AI_KEY_MODE === "byok") return null;
    return (await getQuota(userId, kind)).remaining;
}

/**
 * Stops the request (HTTP 402, with a message the person can read) when doing `amount` more would go past their plans'
 * limits. Called before any AI work starts, so a refused request costs nothing.
 */
export async function assertQuota(userId: string, kind: QuotaKind, amount: number): Promise<void> {
    // With their own OpenAI key people pay OpenAI directly, so the plans' limits don't apply (AI_KEY_MODE=server brings them back).
    if (env.AI_KEY_MODE === "byok") return;
    if (amount <= 0) return;
    const quota = await getQuota(userId, kind);
    if (quota.limit === null || quota.used + amount <= quota.limit) return;

    const label = LABELS[kind];
    if (quota.limit === 0) {
        throw new ApiError(402, `${label} are not included in your ${quota.planName} plan. Upgrade your plan to use them.`);
    }
    if (quota.remaining === 0) {
        throw new ApiError(402, `You have used all ${quota.limit} ${label} in your ${quota.planName} plan. Upgrade your plan to continue.`);
    }
    throw new ApiError(402, `This needs ${amount} ${label}, but only ${quota.remaining} are left in your ${quota.planName} plan. Ask for fewer, or upgrade your plan.`);
}

/**
 * Records that `quantity` of this kind was used. With several bought plans it is taken from the one that runs out first,
 * and spills over to the next when that one is used up, so nothing is wasted on a plan about to expire. With no bought
 * plan it counts against the free plan.
 */
export async function recordUsage(userId: string, kind: QuotaKind, quantity: number): Promise<void> {
    if (env.AI_KEY_MODE === "byok" || quantity <= 0) return;

    const packs = await getPackQuotas(userId, kind);
    if (packs.length === 0) {
        await db.insert(usageEvents).values({ userId, kind, quantity, userPlanId: null });
        return;
    }

    const rows: { userId: string; kind: QuotaKind; quantity: number; userPlanId: string }[] = [];
    let left = quantity;
    for (const pack of packs) {
        if (left <= 0) break;
        // A plan with no fixed limit takes everything that is left.
        const take = pack.remaining === null ? left : Math.min(left, pack.remaining);
        if (take > 0) {
            rows.push({ userId, kind, quantity: take, userPlanId: pack.userPlanId });
            left -= take;
        }
    }
    // The request was checked against the totals first, so this should not happen. If it does (two requests at once), the
    // extra still has to be counted somewhere: on the plan that runs out last.
    if (left > 0) rows.push({ userId, kind, quantity: left, userPlanId: packs[packs.length - 1]!.userPlanId });

    await db.insert(usageEvents).values(rows);
}

/** The person's plans with usage against each limit, for the Plans page. */
export async function getPlanUsage(userId: string) {
    const [questionPacks, gradingPacks, questions, grading, free] = await Promise.all([
        getPackQuotas(userId, "question_generation"),
        getPackQuotas(userId, "ai_grading"),
        getQuota(userId, "question_generation"),
        getQuota(userId, "ai_grading"),
        getFreePlan(),
    ]);
    const gradingBy = new Map(gradingPacks.map((g) => [g.userPlanId, g]));

    // Each bought plan with its own end date and its own usage, in the order they are used up.
    const purchases = questionPacks.map((q) => {
        const g = gradingBy.get(q.userPlanId);
        return {
            id: q.userPlanId,
            plan: q.plan,
            startsAt: q.startsAt,
            expiresAt: q.expiresAt,
            usage: {
                question_generation: { used: q.used, limit: q.limit },
                ai_grading: { used: g?.used ?? 0, limit: g?.limit ?? 0 },
            },
        };
    });

    const first = purchases[0];
    return {
        // The plan being used up first (or the free plan). `purchases` has the full list.
        plan: first?.plan ?? free,
        startsAt: first?.startsAt ?? null,
        expiresAt: first?.expiresAt ?? null,
        isDefault: purchases.length === 0,
        // Totals across every active plan.
        usage: {
            question_generation: { used: questions.used, limit: questions.limit },
            ai_grading: { used: grading.used, limit: grading.limit },
        },
        purchases,
    };
}
