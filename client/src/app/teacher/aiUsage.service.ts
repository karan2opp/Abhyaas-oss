import api from "@/utils/axios";

export interface UsageParams {
  from?: string;
  to?: string;
  examId?: string;
  assignmentId?: string;
  purpose?: string;
  model?: string;
  failedOnly?: boolean;
  search?: string;
}

// Only filters that are set are sent.
const clean = (params: Record<string, unknown>) => Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== "" && v !== false));

export interface UsageTotals {
  calls: number;
  costUsd: number;
  credits: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  failed: number;
}

export interface UsageGroup extends UsageTotals {
  key: string | null;
  name?: string;
  kind?: "exam" | "assignment";
}

export interface UsageSummary {
  creditUsd: number;
  totals: UsageTotals;
  byPurpose: UsageGroup[];
  byModel: UsageGroup[];
  byWork: UsageGroup[];
  unpriced: { model: string; calls: number }[];
  errors: { error: string | null; purpose: string; calls: number }[];
}

export interface UsageLogRow {
  id: string;
  createdAt: string;
  examId: string | null;
  examTitle: string | null;
  assignmentId: string | null;
  purpose: string;
  model: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  costUsd: number;
  credits: number;
  priceMissing: boolean;
  success: boolean;
  error: string | null;
  durationMs: number | null;
}

export const getUsageSummaryService = async (params: UsageParams): Promise<UsageSummary> => {
  const res = await api.get("/ai-usage/summary", { params: clean({ ...params }) });
  return res.data.data;
};

export const getUsageLogsService = async (params: UsageParams, page: number, limit = 25): Promise<{ data: UsageLogRow[]; total: number; page: number; limit: number }> => {
  const res = await api.get("/ai-usage/logs", { params: clean({ ...params, page, limit }) });
  return res.data.data;
};

export const getModelPricesService = async (): Promise<{ model: string; inputPerMillion: number; cachedInputPerMillion: number; outputPerMillion: number }[]> => {
  const res = await api.get("/ai-usage/prices");
  return res.data.data;
};

/** Downloads every log row for the filters as a CSV file. Returns true when the file was cut at its row limit. */
export const downloadUsageCsvService = async (params: UsageParams): Promise<boolean> => {
  const res = await api.get("/ai-usage/logs/export", { params: clean({ ...params }), responseType: "blob" });
  const url = URL.createObjectURL(res.data as Blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `ai-usage-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  return res.headers["x-export-truncated"] === "true";
};
