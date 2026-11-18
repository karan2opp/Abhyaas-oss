"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronLeft, ChevronRight, Download, Loader2, Search, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  downloadUsageCsvService,
  getModelPricesService,
  getUsageLogsService,
  getUsageSummaryService,
  type UsageGroup,
  type UsageLogRow,
  type UsageParams,
  type UsageSummary,
} from "../aiUsage.service";

type Period = "today" | "7d" | "30d" | "custom";
type Tab = "purpose" | "model" | "work";

const PERIODS: { id: Period; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "7d", label: "7 days" },
  { id: "30d", label: "30 days" },
  { id: "custom", label: "Custom" },
];
const TABS: { id: Tab; label: string }[] = [
  { id: "purpose", label: "Purpose" },
  { id: "model", label: "Model" },
  { id: "work", label: "Exam / assignment" },
];
const PAGE_SIZE = 25;
const DAY = 24 * 60 * 60 * 1000;

// What each purpose is called on screen.
const PURPOSE_LABELS: Record<string, string> = {
  question_generation: "Writing questions",
  subtopics: "Planning subtopics",
  exam_intent: "Exam chat",
  blueprint_review: "Blueprint review chat",
  question_review: "Question review chat",
  question_review_check: "Review answer check",
  rubric: "Grading guides",
  grading: "Grading answers",
  grading_guardrail: "Grading safety check",
  question_bank_split: "Past papers: finding questions",
  question_bank_classify: "Past papers: tagging topics",
  question_bank_topics: "Past papers: topic list",
  question_bank_rank: "Past papers: ranking",
  book_indexing: "Indexing books",
  embedding: "Search embeddings",
  transcription: "Voice to text",
  other: "Other",
};
const purposeLabel = (p: string) => PURPOSE_LABELS[p] ?? p;

const fmtUsd = (v: number) => `$${v === 0 ? "0" : v < 0.01 ? v.toFixed(6) : v < 1 ? v.toFixed(4) : v.toFixed(2)}`;
const fmtCredits = (v: number) => (v === 0 ? "0" : v < 0.01 ? v.toFixed(5) : v.toFixed(3));
const fmtNum = (v: number) => v.toLocaleString();
const fmtTime = (iso: string) => new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" });

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const toInputDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const chipClass = "inline-flex items-center gap-1 rounded-full border border-orange-500/40 bg-orange-500/10 py-1 pl-3 pr-1.5 text-xs text-orange-200";
const pillClass = (on: boolean) =>
  cn("h-9 rounded-full border px-4 text-xs font-semibold transition-colors", on ? "border-orange-500 bg-orange-500/15 text-orange-200" : "border-white/15 text-gray-400 hover:text-white");

export default function AiUsagePage() {
  const [period, setPeriod] = useState<Period>("7d");
  const [customFrom, setCustomFrom] = useState(toInputDate(new Date(Date.now() - 7 * DAY)));
  const [customTo, setCustomTo] = useState(toInputDate(new Date()));
  const [failedOnly, setFailedOnly] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [search, setSearch] = useState("");
  // Filters set by clicking a row of a breakdown; shown as chips that can be removed.
  const [picked, setPicked] = useState<{ key: keyof UsageParams; value: string; label: string }[]>([]);
  const [tab, setTab] = useState<Tab>("purpose");
  const [page, setPage] = useState(1);

  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [logs, setLogs] = useState<{ data: UsageLogRow[]; total: number } | null>(null);
  const [prices, setPrices] = useState<Awaited<ReturnType<typeof getModelPricesService>> | null>(null);
  const [showPrices, setShowPrices] = useState(false);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [openRow, setOpenRow] = useState<string | null>(null);

  // The search waits for a pause in typing.
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchText.trim()), 400);
    return () => clearTimeout(t);
  }, [searchText]);

  const params = useMemo<UsageParams>(() => {
    const now = new Date();
    let from: Date;
    let to = now;
    if (period === "today") from = startOfDay(now);
    else if (period === "7d") from = new Date(now.getTime() - 7 * DAY);
    else if (period === "30d") from = new Date(now.getTime() - 30 * DAY);
    else {
      from = startOfDay(new Date(`${customFrom}T00:00:00`));
      to = new Date(new Date(`${customTo}T00:00:00`).getTime() + DAY - 1);
    }
    const p: UsageParams = { from: from.toISOString(), to: to.toISOString(), failedOnly, search: search || undefined };
    for (const f of picked) (p as Record<string, unknown>)[f.key] = f.value;
    return p;
    // `now` is read when a filter changes, which is when the numbers are loaded again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, customFrom, customTo, failedOnly, search, picked]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, l] = await Promise.all([getUsageSummaryService(params), getUsageLogsService(params, page, PAGE_SIZE)]);
      setSummary(s);
      setLogs(l);
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Failed to load AI usage");
    } finally {
      setLoading(false);
    }
  }, [params, page]);

  useEffect(() => {
    void load();
  }, [load]);

  // A new filter starts again from the first page.
  useEffect(() => setPage(1), [params]);

  const addFilter = (key: keyof UsageParams, value: string | null, label: string) => {
    if (!value) return;
    setPicked((prev) => [...prev.filter((f) => f.key !== key), { key, value, label }]);
  };

  const pickGroup = (group: UsageGroup) => {
    const label = tab === "purpose" ? purposeLabel(group.key ?? "") : group.name ?? group.key ?? "";
    if (tab === "purpose") addFilter("purpose", group.key, label);
    else if (tab === "model") addFilter("model", group.key, label);
    else addFilter(group.kind === "assignment" ? "assignmentId" : "examId", group.key, label);
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const truncated = await downloadUsageCsvService(params);
      toast.success(truncated ? "Downloaded the newest 50,000 rows. Narrow the period to get the rest." : "CSV downloaded");
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Failed to export");
    } finally {
      setExporting(false);
    }
  };

  const togglePrices = async () => {
    setShowPrices((v) => !v);
    if (!prices) {
      try {
        setPrices(await getModelPricesService());
      } catch {
        toast.error("Failed to load prices");
      }
    }
  };

  const groups: UsageGroup[] =
    !summary ? [] : tab === "purpose" ? summary.byPurpose : tab === "model" ? summary.byModel : summary.byWork;
  const groupName = (g: UsageGroup) => (tab === "purpose" ? purposeLabel(g.key ?? "") : g.name ?? g.key ?? "Unknown");
  const canPick = (g: UsageGroup) => !!g.key;
  const totalPages = logs ? Math.max(1, Math.ceil(logs.total / PAGE_SIZE)) : 1;
  const t = summary?.totals;

  return (
    <div className="h-full overflow-y-auto custom-scrollbar p-4 sm:p-6 md:p-10">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">AI usage</h2>
          <p className="mt-1 text-gray-400">Every AI call made with your key: what it was for, the tokens it used and what it cost. 1 credit = {fmtUsd(summary?.creditUsd ?? 0.1)}.</p>
        </div>
        <Button onClick={exportCsv} disabled={exporting} className="bg-orange-600 font-semibold text-white hover:bg-orange-700 sm:shrink-0">
          {exporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />} Export CSV
        </Button>
      </div>

      {/* ── Filters ── */}
      <div className="mb-6 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {PERIODS.map((p) => (
            <button key={p.id} type="button" onClick={() => setPeriod(p.id)} aria-pressed={period === p.id} className={pillClass(period === p.id)}>
              {p.label}
            </button>
          ))}
          <label className="ml-1 flex cursor-pointer items-center gap-2 text-xs font-semibold text-gray-300">
            <input type="checkbox" checked={failedOnly} onChange={(e) => setFailedOnly(e.target.checked)} className="h-4 w-4 accent-orange-500" /> Failed only
          </label>
        </div>
        {period === "custom" && (
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-xs text-gray-400">
              From <input type="date" value={customFrom} max={customTo} onChange={(e) => setCustomFrom(e.target.value)} className="ml-1 border-b border-white/20 bg-transparent py-1 text-sm text-white outline-none focus:border-orange-500 [color-scheme:dark]" />
            </label>
            <label className="text-xs text-gray-400">
              To <input type="date" value={customTo} min={customFrom} onChange={(e) => setCustomTo(e.target.value)} className="ml-1 border-b border-white/20 bg-transparent py-1 text-sm text-white outline-none focus:border-orange-500 [color-scheme:dark]" />
            </label>
          </div>
        )}
        <div className="relative max-w-md">
          <Search className="pointer-events-none absolute left-0 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
          <Input value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="Search errors, models, purposes, exam ids" className="pl-6 text-white placeholder:text-zinc-500" />
        </div>
        {picked.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {picked.map((f) => (
              <span key={f.key} className={chipClass}>
                <span className="max-w-[16rem] truncate">{f.label}</span>
                <button type="button" onClick={() => setPicked((prev) => prev.filter((x) => x.key !== f.key))} aria-label={`Remove filter ${f.label}`} className="flex h-4 w-4 items-center justify-center rounded-full text-orange-300 hover:bg-orange-500/20">
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {loading && !summary ? (
        <div className="flex items-center gap-2 py-10 text-sm text-gray-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading AI usage...
        </div>
      ) : (
        summary &&
        t && (
          <div className={cn("space-y-6", loading && "opacity-60 transition-opacity")}>
            {/* ── Warnings ── */}
            {summary.unpriced.length > 0 && (
              <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <p>
                  No price is set for {summary.unpriced.map((u) => `${u.model} (${fmtNum(u.calls)} call${u.calls === 1 ? "" : "s"})`).join(", ")}. Their cost shows as 0 until a price is added to the model price table.
                </p>
              </div>
            )}

            {/* ── Summary ── */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              <Stat label="Cost" value={fmtUsd(t.costUsd)} hint={`${fmtCredits(t.credits)} credits`} accent />
              <Stat label="Calls" value={fmtNum(t.calls)} hint={t.failed > 0 ? `${fmtNum(t.failed)} failed` : "none failed"} warn={t.failed > 0} />
              <Stat label="Input tokens" value={fmtNum(t.inputTokens + t.cachedInputTokens)} hint={`${fmtNum(t.cachedInputTokens)} cached`} />
              <Stat label="Output tokens" value={fmtNum(t.outputTokens)} hint={`${fmtNum(t.reasoningTokens)} reasoning`} />
              <Stat label="Average per call" value={t.calls ? fmtUsd(t.costUsd / t.calls) : "—"} hint={t.calls ? `${fmtCredits(t.credits / t.calls)} credits` : ""} />
            </div>

            {/* ── Breakdown ── */}
            <section>
              <div className="mb-3 flex flex-wrap gap-2">
                {TABS.map((x) => (
                  <button key={x.id} type="button" onClick={() => setTab(x.id)} aria-pressed={tab === x.id} className={pillClass(tab === x.id)}>
                    {x.label}
                  </button>
                ))}
              </div>
              <Card className="border-white/5 bg-[#0f0f11]">
                <CardContent className="p-0">
                  {groups.length === 0 ? (
                    <p className="p-6 text-sm text-gray-500">No AI calls in this period.</p>
                  ) : (
                    <div className="overflow-x-auto custom-scrollbar">
                      <table className="w-full min-w-[34rem] text-left text-sm">
                        <thead>
                          <tr className="border-b border-white/10 text-[11px] uppercase tracking-wider text-gray-500">
                            <th className="px-4 py-3 font-semibold">{TABS.find((x) => x.id === tab)?.label}</th>
                            <th className="px-3 py-3 text-right font-semibold">Calls</th>
                            <th className="px-3 py-3 text-right font-semibold">Input</th>
                            <th className="px-3 py-3 text-right font-semibold">Output</th>
                            <th className="px-3 py-3 text-right font-semibold">Cost</th>
                            <th className="px-4 py-3 text-right font-semibold">Credits</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                          {groups.map((g, i) => (
                            <tr key={`${g.kind ?? ""}${g.key ?? "none"}${i}`} onClick={canPick(g) ? () => pickGroup(g) : undefined} className={cn(canPick(g) && "cursor-pointer hover:bg-white/5")} title={canPick(g) ? "Click to filter the log to this" : undefined}>
                              <td className="px-4 py-3 text-white">
                                {groupName(g)}
                                {g.kind && <span className="ml-2 text-[11px] uppercase text-gray-500">{g.kind}</span>}
                                {g.failed > 0 && <span className="ml-2 text-[11px] text-red-400">{g.failed} failed</span>}
                              </td>
                              <td className="px-3 py-3 text-right tabular-nums text-gray-300">{fmtNum(g.calls)}</td>
                              <td className="px-3 py-3 text-right tabular-nums text-gray-300">{fmtNum(g.inputTokens + g.cachedInputTokens)}</td>
                              <td className="px-3 py-3 text-right tabular-nums text-gray-300">{fmtNum(g.outputTokens)}</td>
                              <td className="px-3 py-3 text-right tabular-nums text-white">{fmtUsd(g.costUsd)}</td>
                              <td className="px-4 py-3 text-right tabular-nums text-orange-300">{fmtCredits(g.credits)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>
              {groups.some(canPick) && <p className="mt-2 text-xs text-gray-500">Click a row to filter the log below to it.</p>}
            </section>

            {/* ── Failures ── */}
            {summary.errors.length > 0 && (
              <section>
                <h3 className="mb-2 text-sm font-semibold uppercase tracking-wider text-gray-400">Failed calls</h3>
                <ul className="divide-y divide-white/5 rounded-xl border border-white/5 bg-[#0f0f11]">
                  {summary.errors.map((e, i) => (
                    <li key={i} className="flex items-start justify-between gap-4 px-4 py-3 text-sm">
                      <div className="min-w-0">
                        <p className="break-words text-red-300">{e.error || "No reason given"}</p>
                        <p className="text-xs text-gray-500">{purposeLabel(e.purpose)}</p>
                      </div>
                      <span className="shrink-0 text-xs font-semibold text-gray-300">{fmtNum(e.calls)}×</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* ── The log ── */}
            <section>
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wider text-gray-400">Log{logs ? ` · ${fmtNum(logs.total)} call${logs.total === 1 ? "" : "s"}` : ""}</h3>
              {logs && logs.data.length === 0 ? (
                <p className="rounded-xl border border-white/5 bg-[#0f0f11] p-6 text-sm text-gray-500">No AI calls match.</p>
              ) : (
                <>
                  {/* Phones: one card per call */}
                  <ul className="space-y-2 md:hidden">
                    {logs?.data.map((r) => (
                      <li key={r.id} className="rounded-xl border border-white/5 bg-[#0f0f11] p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-white">{purposeLabel(r.purpose)}</p>
                            <p className="truncate text-xs text-gray-500">{r.model}</p>
                          </div>
                          <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold", r.success ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400")}>{r.success ? "OK" : "Failed"}</span>
                        </div>
                        <p className="mt-1 text-xs text-gray-400">{fmtTime(r.createdAt)}</p>
                        {(r.examTitle || r.examId) && <p className="mt-1 break-words text-xs text-gray-400">{r.examTitle ?? r.examId}</p>}
                        <div className="mt-2 flex items-center justify-between text-xs">
                          <span className="text-gray-300">{fmtNum(r.inputTokens + r.cachedInputTokens)} in · {fmtNum(r.outputTokens)} out</span>
                          <span className="font-semibold text-orange-300">{r.priceMissing ? "no price" : `${fmtUsd(r.costUsd)} · ${fmtCredits(r.credits)} cr`}</span>
                        </div>
                        {r.error && <p className="mt-2 break-words text-xs text-red-300">{r.error}</p>}
                      </li>
                    ))}
                  </ul>

                  {/* Wide screens: a table */}
                  <Card className="hidden border-white/5 bg-[#0f0f11] md:block">
                    <CardContent className="p-0">
                      <div className="overflow-x-auto custom-scrollbar">
                        <table className="w-full min-w-[52rem] text-left text-sm">
                          <thead>
                            <tr className="border-b border-white/10 text-[11px] uppercase tracking-wider text-gray-500">
                              <th className="px-4 py-3 font-semibold">Time</th>
                              <th className="px-3 py-3 font-semibold">Exam</th>
                              <th className="px-3 py-3 font-semibold">Purpose</th>
                              <th className="px-3 py-3 font-semibold">Model</th>
                              <th className="px-3 py-3 text-right font-semibold">In</th>
                              <th className="px-3 py-3 text-right font-semibold">Out</th>
                              <th className="px-3 py-3 text-right font-semibold">Cost</th>
                              <th className="px-4 py-3 font-semibold">Status</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-white/5">
                            {logs?.data.map((r) => (
                              <React.Fragment key={r.id}>
                                <tr onClick={r.error ? () => setOpenRow(openRow === r.id ? null : r.id) : undefined} className={cn(r.error && "cursor-pointer hover:bg-white/5")}>
                                  <td className="whitespace-nowrap px-4 py-2.5 text-gray-300">{fmtTime(r.createdAt)}</td>
                                  <td className="max-w-[12rem] truncate px-3 py-2.5 text-gray-300">{r.examTitle ?? r.examId ?? (r.assignmentId ? "Assignment" : "—")}</td>
                                  <td className="px-3 py-2.5 text-white">{purposeLabel(r.purpose)}</td>
                                  <td className="whitespace-nowrap px-3 py-2.5 text-gray-400">{r.model}</td>
                                  <td className="px-3 py-2.5 text-right tabular-nums text-gray-300">{fmtNum(r.inputTokens + r.cachedInputTokens)}</td>
                                  <td className="px-3 py-2.5 text-right tabular-nums text-gray-300">{fmtNum(r.outputTokens)}</td>
                                  <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-white" title={`${fmtCredits(r.credits)} credits`}>{r.priceMissing ? <span className="text-amber-400">no price</span> : fmtUsd(r.costUsd)}</td>
                                  <td className="px-4 py-2.5">
                                    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", r.success ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400")}>{r.success ? "OK" : "Failed"}</span>
                                  </td>
                                </tr>
                                {openRow === r.id && r.error && (
                                  <tr>
                                    <td colSpan={8} className="break-words bg-red-500/5 px-4 py-2 text-xs text-red-300">{r.error}</td>
                                  </tr>
                                )}
                              </React.Fragment>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </CardContent>
                  </Card>

                  {logs && logs.total > PAGE_SIZE && (
                    <div className="mt-3 flex items-center justify-between">
                      <span className="text-xs text-gray-500">Page {page} of {totalPages}</span>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => setPage(page - 1)} className="border-white/10 bg-transparent text-gray-300">
                          <ChevronLeft className="mr-1 h-4 w-4" /> Previous
                        </Button>
                        <Button variant="outline" size="sm" disabled={page >= totalPages || loading} onClick={() => setPage(page + 1)} className="border-white/10 bg-transparent text-gray-300">
                          Next <ChevronRight className="ml-1 h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </section>

            {/* ── Prices ── */}
            <section>
              <button type="button" onClick={togglePrices} className="text-sm font-semibold text-orange-400 hover:text-orange-300">
                {showPrices ? "Hide" : "Show"} model prices
              </button>
              {showPrices && (
                <Card className="mt-2 border-white/5 bg-[#0f0f11]">
                  <CardContent className="p-0">
                    <div className="overflow-x-auto custom-scrollbar">
                      <table className="w-full min-w-[28rem] text-left text-sm">
                        <thead>
                          <tr className="border-b border-white/10 text-[11px] uppercase tracking-wider text-gray-500">
                            <th className="px-4 py-3 font-semibold">Model</th>
                            <th className="px-3 py-3 text-right font-semibold">Input</th>
                            <th className="px-3 py-3 text-right font-semibold">Cached input</th>
                            <th className="px-4 py-3 text-right font-semibold">Output</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                          {(prices ?? []).map((p) => (
                            <tr key={p.model}>
                              <td className="px-4 py-2.5 text-white">{p.model}</td>
                              <td className="px-3 py-2.5 text-right tabular-nums text-gray-300">${p.inputPerMillion}</td>
                              <td className="px-3 py-2.5 text-right tabular-nums text-gray-300">${p.cachedInputPerMillion}</td>
                              <td className="px-4 py-2.5 text-right tabular-nums text-gray-300">${p.outputPerMillion}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="border-t border-white/5 px-4 py-2 text-xs text-gray-500">US dollars per million tokens. A new price applies to new calls only; old rows keep the cost they were worked out with.</p>
                  </CardContent>
                </Card>
              )}
            </section>
          </div>
        )
      )}
    </div>
  );
}

function Stat({ label, value, hint, accent, warn }: { label: string; value: string; hint?: string; accent?: boolean; warn?: boolean }) {
  return (
    <div className="rounded-xl border border-white/5 bg-[#0f0f11] p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">{label}</p>
      <p className={cn("mt-1 text-xl font-bold tabular-nums sm:text-2xl", accent ? "text-orange-300" : "text-white")}>{value}</p>
      {hint && <p className={cn("mt-0.5 text-xs", warn ? "text-red-400" : "text-gray-500")}>{hint}</p>}
    </div>
  );
}
