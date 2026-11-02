"use client";

import React, { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Layers, Plus, ClipboardList, ClipboardCheck, Settings, Search, ChevronLeft, ChevronRight, Info, Clock, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { toast } from "sonner";
import {
  createSeriesService,
  listMySeriesService,
  updateSeriesService,
  deleteSeriesService,
  createAssignmentService,
  listMyAssignmentsService,
} from "@/app/teacher/assignments/assignment.service";
import { formatDateTime } from "@/lib/date";
import { DateTimeInput } from "@/components/DateTimeInput";

type View = "landing" | "series" | "seriesDetail" | "seriesSettings" | "standalone";
type StatusFilter = "all" | "upcoming" | "live" | "closed";
const PAGE_SIZE = 10;

// Weekly-series assignments have no fixed startDate/dueDate on the row itself
// (computed per-student, from the day they joined) — they classify as null and
// only ever show up under "All".
const classifyStatus = (a: { startDate: string | null; dueDate: string | null }): "upcoming" | "live" | "closed" | null => {
  const now = new Date();
  if (a.startDate && new Date(a.startDate) > now) return "upcoming";
  if (a.dueDate && new Date(a.dueDate) < now) return "closed";
  if (!a.startDate && !a.dueDate) return null;
  return "live";
};

interface AssignmentEntry {
  id: string;
  title: string;
  totalMarks: number;
  startDate: string | null;
  dueDate: string | null;
  joinCode: string | null;
  seriesId: string | null;
  sequenceOrder: number | null;
  dayGap: number | null;
  createdAt: string;
}

interface SeriesEntry {
  id: string;
  title: string;
  type: "weekly" | "custom";
  joinCode: string;
}

function AssignmentsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [view, setView] = useState<View>("landing");
  const [selectedSeries, setSelectedSeries] = useState<SeriesEntry | null>(null);

  const [allAssignments, setAllAssignments] = useState<AssignmentEntry[]>([]);
  const [series, setSeries] = useState<SeriesEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // Standard (standalone) assignments — backend search + pagination + status
  const [standaloneAssignments, setStandaloneAssignments] = useState<AssignmentEntry[]>([]);
  const [standaloneTotal, setStandaloneTotal] = useState(0);
  const [standalonePage, setStandalonePage] = useState(1);
  const [standaloneSearchQuery, setStandaloneSearchQuery] = useState("");
  const [debouncedStandaloneSearch, setDebouncedStandaloneSearch] = useState("");
  const [standaloneStatus, setStandaloneStatus] = useState<StatusFilter>("all");
  const [standaloneCounts, setStandaloneCounts] = useState({ all: 0, upcoming: 0, live: 0, closed: 0 });
  const [standaloneLoading, setStandaloneLoading] = useState(false);

  // Series detail — client-side status tab (data is already fully fetched)
  const [seriesDetailStatus, setSeriesDetailStatus] = useState<StatusFilter>("all");

  const [assignmentDialogOpen, setAssignmentDialogOpen] = useState(false);
  const [newAssignmentTitle, setNewAssignmentTitle] = useState("");
  const [newAssignmentInstructions, setNewAssignmentInstructions] = useState("");
  const [, setNewAssignmentMarks] = useState("0");
  const [newAssignmentSeriesId, setNewAssignmentSeriesId] = useState("");
  const [newAssignmentDayGap, setNewAssignmentDayGap] = useState("7");
  const [newAssignmentStartDate, setNewAssignmentStartDate] = useState("");
  const [newAssignmentDueDate, setNewAssignmentDueDate] = useState("");
  const [creatingAssignment, setCreatingAssignment] = useState(false);
  const [seriesDialogOpen, setSeriesDialogOpen] = useState(false);
  const [newSeriesTitle, setNewSeriesTitle] = useState("");
  const [newSeriesType, setNewSeriesType] = useState<"weekly" | "custom">("weekly");
  const [creatingSeries, setCreatingSeries] = useState(false);

  const [seriesNameInput, setSeriesNameInput] = useState("");
  const [savingSeriesName, setSavingSeriesName] = useState(false);
  const [deletingSeries, setDeletingSeries] = useState(false);

  const loadOverview = async () => {
    try {
      const [aRes, sRes] = await Promise.all([
        listMyAssignmentsService(),
        listMySeriesService(),
      ]);
      setAllAssignments(aRes.data || []);
      setSeries(sRes.data || []);
    } catch {
      toast.error("Failed to load assignments");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOverview();
  }, []);

  useEffect(() => {
    const seriesIdParam = searchParams.get("seriesId");
    if (seriesIdParam && series.length > 0) {
      const found = series.find((s) => s.id === seriesIdParam);
      if (found) {
        setSelectedSeries(found);
        setView("seriesDetail");
      }
    }
  }, [series, searchParams]);

  useEffect(() => {
    const handler = setTimeout(() => setDebouncedStandaloneSearch(standaloneSearchQuery), 400);
    return () => clearTimeout(handler);
  }, [standaloneSearchQuery]);

  const loadStandalone = async (page: number, search: string, status: StatusFilter) => {
    setStandaloneLoading(true);
    try {
      const [pagedRes, allRes] = await Promise.all([
        listMyAssignmentsService({
          standaloneOnly: true,
          page,
          limit: PAGE_SIZE,
          search: search || undefined,
          status: status === "all" ? undefined : status,
        }),
        // Unpaginated (search-filtered only) fetch used purely to compute the
        // per-tab counts client-side, matching the reference's "All (6)" style.
        listMyAssignmentsService({
          standaloneOnly: true,
          search: search || undefined,
        }),
      ]);
      setStandaloneAssignments(pagedRes.data?.data || []);
      setStandaloneTotal(pagedRes.data?.total || 0);

      const allList: AssignmentEntry[] = allRes.data || [];
      setStandaloneCounts({
        all: allList.length,
        upcoming: allList.filter((a) => classifyStatus(a) === "upcoming").length,
        live: allList.filter((a) => classifyStatus(a) === "live").length,
        closed: allList.filter((a) => classifyStatus(a) === "closed").length,
      });
    } catch {
      toast.error("Failed to load standalone assignments");
    } finally {
      setStandaloneLoading(false);
    }
  };

  useEffect(() => {
    if (view !== "standalone") return;
    setStandalonePage(1);
    loadStandalone(1, debouncedStandaloneSearch, standaloneStatus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, debouncedStandaloneSearch, standaloneStatus]);

  useEffect(() => {
    if (view === "standalone") loadStandalone(standalonePage, debouncedStandaloneSearch, standaloneStatus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [standalonePage]);

  const toDatetimeLocal = (iso: string | null) => {
    if (!iso) return "";
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const handleCreateSeries = async () => {
    if (newSeriesTitle.trim().length < 3) {
      toast.error("Series title must be at least 3 characters");
      return;
    }
    setCreatingSeries(true);
    try {
      await createSeriesService({
        title: newSeriesTitle.trim(),
        type: newSeriesType,
      });
      toast.success("Series created");
      setSeriesDialogOpen(false);
      setNewSeriesTitle("");
      setNewSeriesType("weekly");
      loadOverview();
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Failed to create series");
    } finally {
      setCreatingSeries(false);
    }
  };

  const handleDeleteSeries = async (seriesId: string, title: string) => {
    if (!confirm(`Delete series "${title}"? This permanently deletes every assignment in it. This cannot be undone.`)) return;
    setDeletingSeries(true);
    try {
      await deleteSeriesService(seriesId);
      toast.success("Series deleted");
      setView("series");
      loadOverview();
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Failed to delete series");
    } finally {
      setDeletingSeries(false);
    }
  };

  const openSeriesSettings = () => {
    if (!selectedSeries) return;
    setSeriesNameInput(selectedSeries.title);
    setView("seriesSettings");
  };

  const handleSaveSeriesName = async () => {
    if (!selectedSeries) return;
    if (seriesNameInput.trim().length < 3) {
      toast.error("Series title must be at least 3 characters");
      return;
    }
    setSavingSeriesName(true);
    try {
      const res = await updateSeriesService(selectedSeries.id, { title: seriesNameInput.trim() });
      toast.success("Series renamed");
      setSelectedSeries(res.data);
      loadOverview();
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Failed to rename series");
    } finally {
      setSavingSeriesName(false);
    }
  };

  const selectedNewAssignmentSeries = series.find((s) => s.id === newAssignmentSeriesId);
  const isCustomSeriesAssignment = !!selectedNewAssignmentSeries && selectedNewAssignmentSeries.type === "custom";

  const openCreateAssignment = (seriesId?: string) => {
    if (!seriesId) {
      router.push(`/teacher/assignments/new`);
      return;
    }
    setNewAssignmentSeriesId(seriesId);
    setNewAssignmentStartDate("");
    setNewAssignmentDueDate("");
    const selected = series.find((s) => s.id === seriesId);
    setNewAssignmentDayGap("7");

    if (selected?.type === "custom") {
      const inSeries = allAssignments.filter((a) => a.seriesId === seriesId);
      const last = inSeries.reduce<AssignmentEntry | null>(
        (a, b) => (!a || (b.sequenceOrder ?? 0) > (a.sequenceOrder ?? 0) ? b : a),
        null
      );
      if (last?.dueDate) {
        const nextStart = new Date(new Date(last.dueDate).getTime() + 24 * 60 * 60 * 1000);
        const suggestedDue = new Date(nextStart.getTime() + 7 * 24 * 60 * 60 * 1000);
        setNewAssignmentStartDate(toDatetimeLocal(nextStart.toISOString()));
        setNewAssignmentDueDate(toDatetimeLocal(suggestedDue.toISOString()));
      }
    }
    setAssignmentDialogOpen(true);
  };

  const handleCreateAssignment = async () => {
    if (newAssignmentTitle.trim().length < 3) {
      toast.error("Assignment title must be at least 3 characters");
      return;
    }
    const marks = 0;
    const isWeeklySeries = !!newAssignmentSeriesId && !isCustomSeriesAssignment;
    if (isWeeklySeries && (!newAssignmentDayGap || parseInt(newAssignmentDayGap) < 1)) {
      toast.error("Day gap must be at least 1");
      return;
    }
    if ((!newAssignmentSeriesId || isCustomSeriesAssignment) && (!newAssignmentStartDate || !newAssignmentDueDate) && isCustomSeriesAssignment) {
      toast.error("Start date and due date are required for a custom series assignment");
      return;
    }
    setCreatingAssignment(true);
    try {
      const useExplicitDates = !newAssignmentSeriesId || isCustomSeriesAssignment;
      const res = await createAssignmentService({
        title: newAssignmentTitle.trim(),
        instructions: newAssignmentInstructions.trim() || undefined,
        totalMarks: marks,
        seriesId: newAssignmentSeriesId || undefined,
        dayGap: isWeeklySeries ? parseInt(newAssignmentDayGap) : undefined,
        startDate: useExplicitDates && newAssignmentStartDate ? new Date(newAssignmentStartDate).toISOString() : undefined,
        dueDate: useExplicitDates && newAssignmentDueDate ? new Date(newAssignmentDueDate).toISOString() : undefined,
      });
      toast.success("Assignment created");
      setAssignmentDialogOpen(false);
      setNewAssignmentTitle("");
      setNewAssignmentInstructions("");
      setNewAssignmentMarks("0");
      setNewAssignmentSeriesId("");
      setNewAssignmentDayGap("7");
      setNewAssignmentStartDate("");
      setNewAssignmentDueDate("");
      loadOverview();
      router.push(`/teacher/assignments/${res.data.id}`);
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Failed to create assignment");
    } finally {
      setCreatingAssignment(false);
    }
  };

  const standaloneCount = allAssignments.filter((a) => !a.seriesId).length;

  const renderStatusTabs = (
    counts: { all: number; upcoming: number; live: number; closed: number },
    active: StatusFilter,
    onChange: (s: StatusFilter) => void
  ) => (
    <div className="flex items-center gap-2 mb-4 flex-wrap">
      {([
        ["all", "All", counts.all],
        ["upcoming", "Upcoming", counts.upcoming],
        ["live", "Live", counts.live],
        ["closed", "Closed", counts.closed],
      ] as [StatusFilter, string, number][]).map(([key, label, count]) => (
        <button
          key={key}
          onClick={() => onChange(key)}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
            active === key ? "bg-orange-600/20 border-orange-500/50 text-orange-300 font-semibold" : "bg-transparent border-white/10 text-white/70 hover:bg-white/5"
          }`}
        >
          {label} ({count})
        </button>
      ))}
    </div>
  );

  const renderAssignmentCard = (a: AssignmentEntry, showSequence: boolean) => (
    <Card
      key={a.id}
      onClick={() => router.push(`/teacher/assignments/${a.id}` + (a.seriesId ? `?seriesId=${a.seriesId}` : ""))}
      className="bg-[#0f0f11] border-white/5 hover:border-white/10 transition-all cursor-pointer"
    >
      <CardContent className="p-5">
        <p className="text-white font-semibold text-base truncate mb-1">
          {showSequence ? `#${a.sequenceOrder}: ` : ""}{a.title}
        </p>
        <p className="text-gray-500 text-sm mb-3">
          {a.joinCode ? <>Join code <span className="font-mono font-semibold tracking-widest text-orange-300">{a.joinCode}</span></> : "Joined through the series code"}
        </p>

        <div className="p-4 bg-[#161b28] border border-white/10 rounded-xl mb-4">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
            <Clock className="h-3.5 w-3.5" /> Timeline
          </p>
          {a.dayGap != null ? (
            <p className="text-sm text-gray-300">{a.dayGap}-day window per student, from the day they joined the series.</p>
          ) : (
            <div className="flex gap-3">
              <div className="flex flex-col items-center">
                <span className="h-2 w-2 rounded-full bg-[#18181b]merald-400 shrink-0" />
                <span className="w-px flex-1 bg-white/10 my-1" />
                <span className="h-2 w-2 rounded-full bg-red-400 shrink-0" />
              </div>
              <div className="flex-1 flex flex-col justify-between gap-3 pb-0.5">
                <div>
                  <p className="text-[11px] text-gray-500 uppercase tracking-wide">Start</p>
                  <p className="text-base text-gray-200 font-medium mt-0.5">{a.startDate ? formatDateTime(a.startDate) : "—"}</p>
                </div>
                <div>
                  <p className="text-[11px] text-gray-500 uppercase tracking-wide">Due</p>
                  <p className="text-base text-red-400 font-semibold mt-0.5">{a.dueDate ? formatDateTime(a.dueDate) : "—"}</p>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2">
          <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-600/10 text-emerald-400 border border-emerald-500/20">
            {a.totalMarks} marks
          </span>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="bg-transparent border-white/10 text-white hover:bg-white/5"
              onClick={(e) => {
                e.stopPropagation();
                router.push(`/teacher/assignments/${a.id}` + (a.seriesId ? `?seriesId=${a.seriesId}` : ""));
              }}
            >
              <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
            </Button>
            <Button
              size="sm"
              className="bg-orange-600 hover:bg-orange-700 text-white px-3"
              onClick={(e) => {
                e.stopPropagation();
                router.push(`/teacher/assignments/${a.id}/submissions` + (a.seriesId ? `?seriesId=${a.seriesId}` : ""));
              }}
            >
              <ClipboardCheck className="mr-1 h-3.5 w-3.5" /> Submissions
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );

  if (loading) return <div className="text-gray-400 text-center py-10">Loading assignments...</div>;

  return (
    <div className="p-4 sm:p-6 md:p-10">
      {/* ── Landing: choose a category ───────────────────────────────── */}
      {view === "landing" && (
        <>
          <div className="mb-6">
            <h3 className="text-2xl font-bold text-white">Assignments</h3>
            <p className="text-gray-400 text-base mt-1">Choose a category to manage.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 max-w-2xl">
            <Card
              onClick={() => setView("series")}
              className="bg-[#0f0f11] border-white/5 hover:border-indigo-500/30 transition-all cursor-pointer"
            >
              <CardContent className="p-5 sm:p-8 flex flex-col items-center text-center">
                <div className="h-14 w-14 bg-orange-600/20 text-orange-400 rounded-2xl flex items-center justify-center border border-orange-500/30 mb-4">
                  <Layers className="h-7 w-7" />
                </div>
                <h4 className="text-white font-bold text-xl">Weekly Assignments</h4>
                <p className="text-gray-500 text-base mt-1">{series.length} series</p>
              </CardContent>
            </Card>
            <Card
              onClick={() => setView("standalone")}
              className="bg-[#0f0f11] border-white/5 hover:border-orange-500/30 transition-all cursor-pointer"
            >
              <CardContent className="p-5 sm:p-8 flex flex-col items-center text-center">
                <div className="h-14 w-14 bg-orange-600/20 text-orange-400 rounded-2xl flex items-center justify-center border border-orange-500/30 mb-4">
                  <ClipboardList className="h-7 w-7" />
                </div>
                <h4 className="text-white font-bold text-xl">Standard Assignments</h4>
                <p className="text-gray-500 text-base mt-1">{standaloneCount} assignments</p>
              </CardContent>
            </Card>
          </div>
        </>
      )}

      {/* ── Series list ───────────────────────────────────────────────── */}
      {view === "series" && (
        <>
          <button onClick={() => setView("landing")} className="flex items-center gap-1.5 text-gray-400 hover:text-white text-sm mb-4 transition-colors">
            <ArrowLeft className="h-3.5 w-3.5" /> Back
          </button>
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h3 className="text-2xl font-bold text-white">Weekly Assignments ({series.length})</h3>
              <p className="text-gray-400 text-base mt-1">Ordered assignment series — open one to see its assignments.</p>
            </div>
            <Button className="bg-orange-600 hover:bg-orange-700 text-white shrink-0" onClick={() => setSeriesDialogOpen(true)}>
              <Plus className="mr-2 h-4 w-4" /> New Series
            </Button>
          </div>

          {series.length === 0 ? (
            <Card className="bg-[#0f0f11] border-white/5 py-10 text-center">
              <CardContent>
                <Layers className="h-8 w-8 text-gray-500 mx-auto mb-3" />
                <p className="text-gray-400">No series yet.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {series.map((s) => {
                const inSeriesCount = allAssignments.filter((a) => a.seriesId === s.id).length;
                return (
                  <Card
                    key={s.id}
                    onClick={() => {
                      setSelectedSeries(s);
                      setSeriesDetailStatus("all");
                      setView("seriesDetail");
                    }}
                    className="bg-[#0f0f11] border-white/5 hover:border-white/10 transition-all cursor-pointer"
                  >
                    <CardContent className="p-5">
                      <div className="h-9 w-9 bg-orange-600/20 text-orange-400 rounded-lg flex items-center justify-center border border-orange-500/30 mb-3">
                        <Layers className="h-4 w-4" />
                      </div>
                      <p className="text-white font-semibold text-base truncate">{s.title}</p>
                      <div className="flex items-center gap-2 mt-1.5">
                        <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${s.type === "custom" ? "bg-purple-500/20 text-purple-300" : "bg-orange-500/20 text-orange-300"}`}>
                          {s.type === "custom" ? "Custom" : "Weekly"}
                        </span>
                        <span className="text-base text-gray-400">{inSeriesCount} assignments</span>
                      </div>
                      <p className="text-sm text-gray-500 mt-1">
                        Join code <span className="font-mono font-semibold tracking-widest text-orange-300">{s.joinCode}</span>
                      </p>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* ── Series detail: assignments within one series ─────────────── */}
      {view === "seriesDetail" && selectedSeries && (
        <>
          <button onClick={() => setView("series")} className="flex items-center gap-1.5 text-gray-400 hover:text-white text-sm mb-4 transition-colors">
            <ArrowLeft className="h-3.5 w-3.5" /> Back to Series
          </button>
          <div className="mb-6 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h3 className="text-2xl font-bold text-white">{selectedSeries.title}</h3>
              <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${selectedSeries.type === "custom" ? "bg-purple-500/20 text-purple-300" : "bg-orange-500/20 text-orange-300"}`}>
                {selectedSeries.type === "custom" ? "Custom" : "Weekly"}
              </span>
              <span className="text-sm text-gray-400">
                Join code <span className="font-mono font-semibold tracking-widest text-orange-300">{selectedSeries.joinCode}</span>
              </span>
            </div>
            <div className="flex gap-2 shrink-0">
              <Button variant="outline" className="bg-transparent border-white/10 text-white hover:bg-white/5" onClick={openSeriesSettings}>
                <Settings className="mr-2 h-4 w-4" /> Update Series
              </Button>
              <Button className="bg-orange-600 hover:bg-orange-700 text-white" onClick={() => openCreateAssignment(selectedSeries.id)}>
                <Plus className="mr-2 h-4 w-4" /> Add Assignment
              </Button>
            </div>
          </div>

          {(() => {
            const inSeries = allAssignments
              .filter((a) => a.seriesId === selectedSeries.id)
              .sort((a, b) => (a.sequenceOrder ?? 0) - (b.sequenceOrder ?? 0));

            const counts = {
              all: inSeries.length,
              upcoming: inSeries.filter((a) => classifyStatus(a) === "upcoming").length,
              live: inSeries.filter((a) => classifyStatus(a) === "live").length,
              closed: inSeries.filter((a) => classifyStatus(a) === "closed").length,
            };
            const filtered = seriesDetailStatus === "all" ? inSeries : inSeries.filter((a) => classifyStatus(a) === seriesDetailStatus);

            return (
              <>
                {inSeries.length > 0 && renderStatusTabs(counts, seriesDetailStatus, setSeriesDetailStatus)}
                {filtered.length === 0 ? (
                  <Card className="bg-[#0f0f11] border-white/5 py-10 text-center">
                    <CardContent>
                      <ClipboardList className="h-8 w-8 text-gray-500 mx-auto mb-3" />
                      <p className="text-gray-400">
                        {inSeries.length === 0 ? "No assignments in this series yet." : `No ${seriesDetailStatus} assignments.`}
                      </p>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {filtered.map((a) => renderAssignmentCard(a, true))}
                  </div>
                )}
              </>
            );
          })()}
        </>
      )}

      {/* ── Series settings: rename or delete this series ─────────────── */}
      {view === "seriesSettings" && selectedSeries && (
        <div className="max-w-2xl">
          <button onClick={() => setView("seriesDetail")} className="flex items-center gap-1.5 text-gray-400 hover:text-white text-sm mb-4 transition-colors">
            <ArrowLeft className="h-3.5 w-3.5" /> Back to {selectedSeries.title}
          </button>

          <div className="mb-6">
            <h3 className="text-2xl font-bold text-white">Series Settings</h3>
            <p className="text-gray-400 text-base mt-1">Update this series' name, or delete it entirely.</p>
          </div>

          <Card className="bg-[#0f0f11] border-white/5 mb-6">
            <CardContent className="space-y-3">
              <label className="text-sm font-medium text-gray-300">Series Name</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={seriesNameInput}
                  onChange={(e) => setSeriesNameInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSaveSeriesName()}
                  className="flex-1 py-2.5 text-white text-base transition-all rounded-none border-0 border-b border-white/20 bg-transparent px-0 transition-colors placeholder:text-zinc-500 focus:border-orange-500 focus:outline-none focus:ring-0"
                />
                <Button className="bg-orange-600 hover:bg-orange-700 text-white shrink-0" onClick={handleSaveSeriesName} disabled={savingSeriesName}>
                  {savingSeriesName ? "Saving..." : "Save"}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-[#0f0f11] border-red-500/20">
            <CardContent className="space-y-3">
              <div>
                <p className="text-base font-semibold text-red-400">Danger Zone</p>
                <p className="text-gray-400 text-sm mt-1">
                  Deleting this series permanently deletes every assignment in it. This cannot be undone.
                </p>
              </div>
              <Button variant="destructive" onClick={() => handleDeleteSeries(selectedSeries.id, selectedSeries.title)} disabled={deletingSeries}>
                {deletingSeries ? "Deleting..." : "Delete Series"}
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Standard (standalone) assignments — search + pagination ──── */}
      {view === "standalone" && (
        <>
          <button onClick={() => setView("landing")} className="flex items-center gap-1.5 text-gray-400 hover:text-white text-sm mb-4 transition-colors">
            <ArrowLeft className="h-3.5 w-3.5" /> Back
          </button>
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="text-2xl font-bold text-white">Standard Assignments ({standaloneTotal})</h3>
              <p className="text-gray-400 text-base mt-1">Assignments outside any series. Each has its own join code.</p>
            </div>
            <Button className="bg-orange-600 hover:bg-orange-700 text-white shrink-0" onClick={() => openCreateAssignment()}>
              <Plus className="mr-2 h-4 w-4" /> New Standalone Assignment
            </Button>
          </div>

          <div className="relative max-w-md mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-orange-400" />
            <input
              type="text"
              placeholder="Search assignments..."
              value={standaloneSearchQuery}
              onChange={(e) => setStandaloneSearchQuery(e.target.value)} className="text-white placeholder:text-zinc-400 h-11 text-sm transition-all pl-10 rounded-none border-0 border-b border-white/20 bg-transparent px-0 transition-colors placeholder:text-zinc-500 focus:border-orange-500 focus:outline-none focus:ring-0"
            />
          </div>

          {renderStatusTabs(standaloneCounts, standaloneStatus, setStandaloneStatus)}

          {standaloneLoading ? (
            <div className="text-gray-400 text-center py-10">Loading...</div>
          ) : standaloneAssignments.length === 0 ? (
            <Card className="bg-[#0f0f11] border-white/5 py-10 text-center">
              <CardContent>
                <ClipboardList className="h-8 w-8 text-gray-500 mx-auto mb-3" />
                <p className="text-gray-400">
                  {debouncedStandaloneSearch
                    ? `No assignments matching "${debouncedStandaloneSearch}".`
                    : standaloneStatus !== "all"
                    ? `No ${standaloneStatus} assignments.`
                    : "No standalone assignments yet."}
                </p>
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {standaloneAssignments.map((a) => renderAssignmentCard(a, false))}
              </div>

              <div className="flex items-center justify-between mt-6">
                <p className="text-xs text-gray-500">
                  Showing {(standalonePage - 1) * PAGE_SIZE + 1}-{Math.min(standalonePage * PAGE_SIZE, standaloneTotal)} of {standaloneTotal}
                </p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="bg-transparent border-white/10 text-white hover:bg-white/5"
                    onClick={() => setStandalonePage((p) => Math.max(1, p - 1))}
                    disabled={standalonePage <= 1}
                  >
                    <ChevronLeft className="mr-1 h-3.5 w-3.5" /> Previous
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="bg-transparent border-white/10 text-white hover:bg-white/5"
                    onClick={() => setStandalonePage((p) => p + 1)}
                    disabled={standalonePage * PAGE_SIZE >= standaloneTotal}
                  >
                    Next <ChevronRight className="ml-1 h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </>
      )}

      {/* ── Create Assignment Dialog ─────────────────────────────────── */}
      <Dialog open={assignmentDialogOpen} onOpenChange={setAssignmentDialogOpen}>
        <DialogContent className="bg-[#0f0f11] border border-white/10 text-white sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-white text-xl font-bold">Create New Assignment</DialogTitle>
            {newAssignmentSeriesId ? (
              <p className="text-sm text-gray-400">
                Adding to <span className="text-orange-400 font-semibold">{series.find((s) => s.id === newAssignmentSeriesId)?.title?.toUpperCase()}</span>
              </p>
            ) : (
              <p className="text-sm text-gray-400">Standalone assignment with its own join code</p>
            )}
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-300">Assignment Title</label>
              <input
                autoFocus
                type="text"
                placeholder={newAssignmentSeriesId ? "e.g. Week 1: Intro to Neural Nets" : "e.g. Chapter 3 Homework"}
                value={newAssignmentTitle}
                onChange={(e) => setNewAssignmentTitle(e.target.value)}
                className="w-full py-3 text-white placeholder:text-gray-500 transition-all text-sm rounded-none border-0 border-b border-white/20 bg-transparent px-0 transition-colors placeholder:text-zinc-500 focus:border-orange-500 focus:outline-none focus:ring-0"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-300">Instructions (optional)</label>
              <textarea
                placeholder="Provide guidance or resources for students..."
                value={newAssignmentInstructions}
                onChange={(e) => setNewAssignmentInstructions(e.target.value)}
                rows={3}
                className="w-full bg-[#18181b] border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-gray-500 focus:outline-none focus:ring-1 focus:ring-white/30 transition-all text-sm resize-none"
              />
            </div>

            {newAssignmentSeriesId && !isCustomSeriesAssignment && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-300">Schedule Gap (Days)</label>
                <input
                  type="number"
                  min="1"
                  value={newAssignmentDayGap}
                  onChange={(e) => setNewAssignmentDayGap(e.target.value)}
                  className="w-full py-3 text-white transition-all text-sm rounded-none border-0 border-b border-white/20 bg-transparent px-0 transition-colors placeholder:text-zinc-500 focus:border-orange-500 focus:outline-none focus:ring-0"
                />
              </div>
            )}

            {newAssignmentSeriesId && !isCustomSeriesAssignment && (
              <div className="flex items-start gap-2.5 p-3 bg-orange-500/10 border border-orange-500/30 rounded-lg">
                <Info className="h-4 w-4 text-orange-400 shrink-0 mt-0.5" />
                <p className="text-xs text-gray-300">
                  The <span className="font-semibold text-white">Schedule Gap</span> determines when this assignment becomes available after the previous one in the series ends. A gap of {newAssignmentDayGap || "N"} days means students have a {newAssignmentDayGap || "N"}-day window.
                </p>
              </div>
            )}

            {newAssignmentSeriesId && isCustomSeriesAssignment && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-gray-300">Start Date</label>
                  <DateTimeInput
                    value={newAssignmentStartDate}
                    onChange={(v) => setNewAssignmentStartDate(v)}
                   
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-gray-300">Due Date</label>
                  <DateTimeInput
                    value={newAssignmentDueDate}
                    onChange={(v) => setNewAssignmentDueDate(v)}
                   
                  />
                </div>
              </div>
            )}

            {!newAssignmentSeriesId && (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-gray-300">Start Date (optional)</label>
                    <DateTimeInput
                      value={newAssignmentStartDate}
                      onChange={(v) => setNewAssignmentStartDate(v)}
                     
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-gray-300">Due Date (optional)</label>
                    <DateTimeInput
                      value={newAssignmentDueDate}
                      onChange={(v) => setNewAssignmentDueDate(v)}
                     
                    />
                  </div>
                </div>
              </>
            )}
          </div>

          <DialogFooter className="bg-transparent border-0 p-0 mt-2">
            <Button variant="ghost" size="lg" className="text-gray-300 hover:text-white" onClick={() => setAssignmentDialogOpen(false)}>
              Cancel
            </Button>
            <Button size="lg" className="bg-orange-600 hover:bg-orange-700 text-white" onClick={handleCreateAssignment} disabled={creatingAssignment}>
              {creatingAssignment ? "Creating..." : "Continue to Questions"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Create Series Dialog ─────────────────────────────────────── */}
      <Dialog open={seriesDialogOpen} onOpenChange={setSeriesDialogOpen}>
        <DialogContent className="bg-[#0f0f11] border border-white/10 text-white sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-white text-xl font-bold">Create Assignment Series</DialogTitle>
            <p className="text-sm text-gray-400">A series is an ordered set of assignments students work through.</p>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-300">Series Title</label>
              <input
                autoFocus
                type="text"
                placeholder="e.g. AI Course - Weekly Assignments"
                value={newSeriesTitle}
                onChange={(e) => setNewSeriesTitle(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreateSeries()}
                className="w-full py-3 text-white placeholder:text-gray-500 transition-all text-sm rounded-none border-0 border-b border-white/20 bg-transparent px-0 transition-colors placeholder:text-zinc-500 focus:border-orange-500 focus:outline-none focus:ring-0"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-300">Schedule type</label>
              <RadioGroup
                value={newSeriesType}
                onValueChange={(value) => setNewSeriesType(value as "weekly" | "custom")}
                className="grid grid-cols-1 gap-2"
              >
                {(
                  [
                    { value: "weekly", title: "Weekly Series", desc: "Each student's schedule starts from the day they join the series. Set a day-gap per assignment." },
                    { value: "custom", title: "Custom Series", desc: "You set a fixed start/due date for each assignment — same for every student." },
                  ] as const
                ).map((opt) => (
                  <label
                    key={opt.value}
                    className={`flex items-start gap-3 text-left p-4 rounded-xl border cursor-pointer transition-all ${newSeriesType === opt.value ? "bg-orange-500/20 border-orange-500/50" : "bg-[#18181b] border-white/10 hover:bg-white/5"}`}
                  >
                    <RadioGroupItem value={opt.value} className="mt-0.5 border-gray-500 data-[checked]:border-blue-400" />
                    <div>
                      <p className="text-sm font-semibold text-white">{opt.title}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{opt.desc}</p>
                    </div>
                  </label>
                ))}
              </RadioGroup>
            </div>
          </div>

          <DialogFooter className="bg-transparent border-0 p-0 mt-2">
            <Button variant="ghost" size="lg" className="text-gray-300 hover:text-white" onClick={() => setSeriesDialogOpen(false)}>
              Cancel
            </Button>
            <Button size="lg" className="bg-orange-600 hover:bg-orange-700 text-white" onClick={handleCreateSeries} disabled={creatingSeries}>
              {creatingSeries ? "Creating..." : "Create Series"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function AssignmentsPage() {
  return (
    <Suspense fallback={<div className="text-gray-400 text-center py-12">Loading...</div>}>
      <AssignmentsPageContent />
    </Suspense>
  );
}
