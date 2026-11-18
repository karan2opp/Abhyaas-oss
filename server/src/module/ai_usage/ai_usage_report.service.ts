import { and, count, desc, eq, gte, ilike, inArray, isNotNull, lte, or, sql, type SQL } from "drizzle-orm";
import db from "../../common/db/index.js";
import { aiUsageLog, modelPrices, users, exams, assignments } from "../../common/db/schema.js";

// 50 credits = $5, so one credit is ten cents.
export const CREDIT_USD = 0.1;

export interface UsageFilters {
    from: Date;
    to: Date;
    organisationId?: string | undefined;
    userId?: string | undefined;
    examId?: string | undefined;
    assignmentId?: string | undefined;
    purpose?: string | undefined;
    model?: string | undefined;
    failedOnly?: boolean | undefined;
    search?: string | undefined;
}

const where = (f: UsageFilters): SQL => {
    const conditions: SQL[] = [gte(aiUsageLog.createdAt, f.from), lte(aiUsageLog.createdAt, f.to)];
    if (f.organisationId) conditions.push(eq(aiUsageLog.organisationId, f.organisationId));
    if (f.userId) conditions.push(eq(aiUsageLog.userId, f.userId));
    if (f.examId) conditions.push(eq(aiUsageLog.examId, f.examId));
    if (f.assignmentId) conditions.push(eq(aiUsageLog.assignmentId, f.assignmentId));
    if (f.purpose) conditions.push(eq(aiUsageLog.purpose, f.purpose));
    if (f.model) conditions.push(eq(aiUsageLog.model, f.model));
    if (f.failedOnly) conditions.push(eq(aiUsageLog.success, false));
    if (f.search) {
        const like = `%${f.search}%`;
        conditions.push(or(ilike(aiUsageLog.error, like), ilike(aiUsageLog.model, like), ilike(aiUsageLog.purpose, like), ilike(aiUsageLog.examId, like), ilike(aiUsageLog.assignmentId, like))!);
    }
    return and(...conditions)!;
};

// The sums every breakdown shows.
const sums = {
    calls: count(),
    costUsd: sql<number>`coalesce(sum(${aiUsageLog.costUsd}), 0)`.mapWith(Number),
    inputTokens: sql<number>`coalesce(sum(${aiUsageLog.inputTokens}), 0)`.mapWith(Number),
    cachedInputTokens: sql<number>`coalesce(sum(${aiUsageLog.cachedInputTokens}), 0)`.mapWith(Number),
    outputTokens: sql<number>`coalesce(sum(${aiUsageLog.outputTokens}), 0)`.mapWith(Number),
    reasoningTokens: sql<number>`coalesce(sum(${aiUsageLog.reasoningTokens}), 0)`.mapWith(Number),
    failed: sql<number>`coalesce(sum(case when ${aiUsageLog.success} = false then 1 else 0 end), 0)`.mapWith(Number),
};

const withCredits = <T extends { costUsd: number }>(row: T) => ({ ...row, credits: row.costUsd / CREDIT_USD });

/** Totals, breakdowns (purpose, model, organisation, teacher, exam / assignment) and warnings for a period. */
export const getUsageSummary = async (f: UsageFilters) => {
    const w = where(f);
    const [totals] = await db.select(sums).from(aiUsageLog).where(w);

    const byPurpose = await db.select({ key: aiUsageLog.purpose, ...sums }).from(aiUsageLog).where(w).groupBy(aiUsageLog.purpose).orderBy(desc(sums.costUsd));
    const byModel = await db.select({ key: aiUsageLog.model, ...sums }).from(aiUsageLog).where(w).groupBy(aiUsageLog.model).orderBy(desc(sums.costUsd));


    const userRows = await db.select({ key: aiUsageLog.userId, ...sums }).from(aiUsageLog).where(w).groupBy(aiUsageLog.userId).orderBy(desc(sums.costUsd)).limit(50);
    const userIds = userRows.map((r) => r.key).filter((id): id is string => !!id);
    const userNames = userIds.length ? new Map((await db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(inArray(users.id, userIds))).map((u) => [u.id, `${u.name} (${u.email})`])) : new Map<string, string>();
    const byUser = userRows.map((r) => ({ ...r, name: r.key ? userNames.get(r.key) ?? "Deleted user" : "Not tied to a person" }));

    // What each exam and assignment cost (the "why did this exam cost 3.7 credits?" view).
    const examRows = await db.select({ key: aiUsageLog.examId, ...sums }).from(aiUsageLog).where(and(w, isNotNull(aiUsageLog.examId))).groupBy(aiUsageLog.examId).orderBy(desc(sums.costUsd)).limit(20);
    const examIds = examRows.map((r) => r.key!).filter(Boolean);
    const examTitles = examIds.length ? new Map((await db.select({ id: exams.id, title: exams.title }).from(exams).where(inArray(exams.id, examIds))).map((e) => [e.id, e.title])) : new Map<string, string>();
    const assignmentRows = await db.select({ key: aiUsageLog.assignmentId, ...sums }).from(aiUsageLog).where(and(w, isNotNull(aiUsageLog.assignmentId))).groupBy(aiUsageLog.assignmentId).orderBy(desc(sums.costUsd)).limit(20);
    const assignmentIds = assignmentRows.map((r) => r.key!).filter(Boolean);
    const assignmentTitles = assignmentIds.length ? new Map((await db.select({ id: assignments.id, title: assignments.title }).from(assignments).where(inArray(assignments.id, assignmentIds))).map((a) => [a.id, a.title])) : new Map<string, string>();
    const byWork = [
        ...examRows.map((r) => ({ ...r, kind: "exam" as const, name: examTitles.get(r.key!) ?? "Deleted exam" })),
        ...assignmentRows.map((r) => ({ ...r, kind: "assignment" as const, name: assignmentTitles.get(r.key!) ?? "Deleted assignment" })),
    ].sort((a, b) => b.costUsd - a.costUsd).slice(0, 20);

    // Models that were used but have no price, so their cost shows as 0.
    const unpriced = await db
        .select({ model: aiUsageLog.model, calls: count() })
        .from(aiUsageLog)
        .where(and(w, eq(aiUsageLog.priceMissing, true)))
        .groupBy(aiUsageLog.model);

    // Errors, grouped, so a pattern (a rate limit, a bad key) is easy to see.
    const errors = await db
        .select({ error: aiUsageLog.error, purpose: aiUsageLog.purpose, calls: count() })
        .from(aiUsageLog)
        .where(and(w, eq(aiUsageLog.success, false)))
        .groupBy(aiUsageLog.error, aiUsageLog.purpose)
        .orderBy(desc(count()))
        .limit(10);

    return {
        creditUsd: CREDIT_USD,
        totals: withCredits(totals!),
        byPurpose: byPurpose.map(withCredits),
        byModel: byModel.map(withCredits),
        byUser: byUser.map(withCredits),
        byWork: byWork.map(withCredits),
        unpriced,
        errors,
    };
};

const logSelect = {
    id: aiUsageLog.id,
    createdAt: aiUsageLog.createdAt,
    organisationId: aiUsageLog.organisationId,
    userId: aiUsageLog.userId,
    userName: users.name,
    userEmail: users.email,
    examId: aiUsageLog.examId,
    examTitle: exams.title,
    assignmentId: aiUsageLog.assignmentId,
    purpose: aiUsageLog.purpose,
    model: aiUsageLog.model,
    inputTokens: aiUsageLog.inputTokens,
    cachedInputTokens: aiUsageLog.cachedInputTokens,
    outputTokens: aiUsageLog.outputTokens,
    reasoningTokens: aiUsageLog.reasoningTokens,
    costUsd: aiUsageLog.costUsd,
    priceMissing: aiUsageLog.priceMissing,
    success: aiUsageLog.success,
    error: aiUsageLog.error,
    durationMs: aiUsageLog.durationMs,
};

const logQuery = (f: UsageFilters) =>
    db
        .select(logSelect)
        .from(aiUsageLog)
        .leftJoin(users, eq(users.id, aiUsageLog.userId))
        .leftJoin(exams, eq(exams.id, aiUsageLog.examId))
        .where(where(f))
        .orderBy(desc(aiUsageLog.createdAt));

/** One page of the log, newest first, with the names behind the ids. */
export const getUsageLogs = async (f: UsageFilters, page: number, limit: number) => {
    const rows = await logQuery(f).limit(limit).offset((page - 1) * limit);
    const [total] = await db.select({ value: count() }).from(aiUsageLog).where(where(f));
    return { data: rows.map(withCredits), total: Number(total?.value) || 0, page, limit };
};

export const EXPORT_LIMIT = 50_000;

// A cell that starts with = + - @ is read as a formula by spreadsheets, and the error text comes from outside, so it is
// defanged; commas, quotes and line breaks are quoted.
const csvCell = (value: unknown): string => {
    if (value === null || value === undefined) return "";
    let text = value instanceof Date ? value.toISOString() : String(value);
    if (/^[=+\-@\t\r]/.test(text) && typeof value === "string") text = `'${text}`;
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const CSV_COLUMNS: { header: string; value: (r: Awaited<ReturnType<typeof getUsageLogs>>["data"][number]) => unknown }[] = [
    { header: "time", value: (r) => r.createdAt },
    { header: "user", value: (r) => (r.userName ? `${r.userName} <${r.userEmail}>` : r.userId) },
    { header: "exam", value: (r) => r.examTitle ?? r.examId },
    { header: "assignment_id", value: (r) => r.assignmentId },
    { header: "purpose", value: (r) => r.purpose },
    { header: "model", value: (r) => r.model },
    { header: "input_tokens", value: (r) => r.inputTokens },
    { header: "cached_input_tokens", value: (r) => r.cachedInputTokens },
    { header: "output_tokens", value: (r) => r.outputTokens },
    { header: "reasoning_tokens", value: (r) => r.reasoningTokens },
    { header: "cost_usd", value: (r) => r.costUsd },
    { header: "credits", value: (r) => r.credits },
    { header: "price_missing", value: (r) => r.priceMissing },
    { header: "success", value: (r) => r.success },
    { header: "error", value: (r) => r.error },
    { header: "duration_ms", value: (r) => r.durationMs },
];

/** Every row for the filters (up to EXPORT_LIMIT, newest first) as CSV text. */
export const exportUsageCsv = async (f: UsageFilters): Promise<{ csv: string; truncated: boolean }> => {
    const rows = (await logQuery(f).limit(EXPORT_LIMIT + 1)).map(withCredits);
    const truncated = rows.length > EXPORT_LIMIT;
    const lines = [CSV_COLUMNS.map((c) => c.header).join(",")];
    for (const row of rows.slice(0, EXPORT_LIMIT)) lines.push(CSV_COLUMNS.map((c) => csvCell(c.value(row))).join(","));
    return { csv: lines.join("\n") + "\n", truncated };
};

/** The price table, for the dashboard. */
export const listModelPrices = async () => await db.select().from(modelPrices).orderBy(modelPrices.model);
