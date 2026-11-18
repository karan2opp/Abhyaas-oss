import type { Request, Response } from "express";
import { z } from "zod";
import { ApiResponse } from "../../common/utils/ApiResponse.js";
import { ApiError } from "../../common/utils/ApiError.js";
import { exportUsageCsv, getUsageLogs, getUsageSummary, listModelPrices, type UsageFilters } from "./ai_usage_report.service.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const text = z.string().trim().min(1).max(200).optional();

const filterSchema = z.object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    examId: text,
    assignmentId: text,
    purpose: text,
    model: text,
    failedOnly: z.enum(["true", "false"]).optional(),
    search: text,
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(200).default(25),
});

// The period is the last 7 days unless given. Filters left out are not applied.
const readFilters = (req: Request) => {
    const parsed = filterSchema.safeParse(req.query);
    if (!parsed.success) throw ApiError.badRequest(parsed.error.issues[0]?.message ?? "Invalid filters");
    const q = parsed.data;
    const to = q.to ?? new Date();
    const from = q.from ?? new Date(to.getTime() - 7 * DAY_MS);
    if (from > to) throw ApiError.badRequest("The start of the period must be before its end");
    const filters: UsageFilters = {
        from,
        to,
        // A teacher only ever sees their own AI usage, whatever the request asks for.
        userId: req.user!.id,
        examId: q.examId,
        assignmentId: q.assignmentId,
        purpose: q.purpose,
        model: q.model,
        failedOnly: q.failedOnly === "true",
        search: q.search,
    };
    return { filters, page: q.page, limit: q.limit };
};

export const getSummary = async (req: Request, res: Response) => {
    const { filters } = readFilters(req);
    return ApiResponse.ok(res, "AI usage summary", { from: filters.from, to: filters.to, ...(await getUsageSummary(filters)) });
};

export const getLogs = async (req: Request, res: Response) => {
    const { filters, page, limit } = readFilters(req);
    return ApiResponse.ok(res, "AI usage log", await getUsageLogs(filters, page, limit));
};

export const exportLogs = async (req: Request, res: Response) => {
    const { filters } = readFilters(req);
    const { csv, truncated } = await exportUsageCsv(filters);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="ai-usage-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.setHeader("Access-Control-Expose-Headers", "X-Export-Truncated");
    res.setHeader("X-Export-Truncated", truncated ? "true" : "false");
    res.send(csv);
};

export const getPrices = async (_req: Request, res: Response) => ApiResponse.ok(res, "Model prices", await listModelPrices());
