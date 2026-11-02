"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Clock, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { getMyExamsService, joinExamService } from "@/app/student/student.service";
import { formatDateTime } from "@/lib/date";
import { Pagination } from "@/components/Pagination";

interface ExamEntry {
  id: string;
  title: string;
  type: "SCHEDULED" | "ON_DEMAND";
  totalMarks: number;
  startTime: string | null;
  endTime: string | null;
  joinCode?: string;
  category?: "upcoming" | "inprogress" | "closed";
  mySubmission?: { id: string; status: string; score: number | null } | null;
}

type CategoryKey = "all" | "upcoming" | "inprogress" | "closed";

export default function StudentExamsPage() {
  const router = useRouter();

  const [exams, setExams] = useState<ExamEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [startingExamId, setStartingExamId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState({ upcoming: 0, inprogress: 0, closed: 0 });
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [category, setCategory] = useState<CategoryKey>("all");
  const PAGE_SIZE = 10;

  useEffect(() => {
    const handler = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(handler);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, category]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res = await getMyExamsService(
          page,
          PAGE_SIZE,
          debouncedSearch || undefined,
          category
        );
        const result = res.data || { data: [], total: 0, counts: { upcoming: 0, inprogress: 0, closed: 0 } };
        setExams(result.data || []);
        setTotal(result.total || 0);
        setCounts(result.counts || { upcoming: 0, inprogress: 0, closed: 0 });
        setTotalPages(Math.max(1, Math.ceil((result.total || 0) / PAGE_SIZE)));
      } catch {
        toast.error("Failed to load exams");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, debouncedSearch, category]);

  const handleStartExam = async (exam: ExamEntry) => {
    if (!exam.joinCode) return;
    setStartingExamId(exam.id);
    try {
      const res = await joinExamService(exam.joinCode);
      router.push(`/student/exams/${res.data.submission.id}`);
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Failed to start exam");
      setStartingExamId(null);
    }
  };

  const statusInfo = (exam: ExamEntry) => {
    const sub = exam.mySubmission;
    if (!sub) return { label: "Not Attempted", cls: "bg-zinc-800/60 text-zinc-400 border-zinc-700" };
    if (sub.status === "inprogress") return { label: "In Progress", cls: "bg-amber-500/10 text-amber-300 border-amber-500/30" };
    if (sub.status === "evaluating") return { label: "Evaluating", cls: "bg-orange-500/10 text-orange-300 border-orange-500/30" };
    return { label: `Submitted · ${sub.score ?? 0}/${exam.totalMarks}`, cls: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30" };
  };

  const renderAction = (exam: ExamEntry) => {
    const sub = exam.mySubmission;
    if (sub?.status === "submitted" || sub?.status === "evaluating") {
      return (
        <Button
          size="sm"
          className="bg-zinc-800 hover:bg-zinc-700 text-white"
          onClick={() => router.push(`/student/results/${sub.id}`)}
        >
          View Result
        </Button>
      );
    }
    if (sub?.status === "inprogress") {
      return (
        <Button
          size="sm"
          className="bg-amber-600 hover:bg-amber-700 text-white"
          onClick={() => router.push(`/student/exams/${sub.id}`)}
        >
          Resume
        </Button>
      );
    }
    if (exam.type === "SCHEDULED" && exam.startTime && new Date(exam.startTime) > new Date()) {
      return (
        <Button
          size="sm"
          variant="outline"
          className="bg-transparent border-white/10 text-gray-400 hover:text-white"
          onClick={() => exam.joinCode && router.push(`/student/waiting/${exam.joinCode}`)}
        >
          Not Started Yet
        </Button>
      );
    }
    return (
      <Button
        size="sm"
        className="bg-orange-600 hover:bg-orange-700 text-white"
        onClick={() => handleStartExam(exam)}
        disabled={startingExamId === exam.id}
      >
        {startingExamId === exam.id ? "Starting..." : "Start Exam"}
      </Button>
    );
  };

  const tabs: { key: CategoryKey; label: string; count: number }[] = [
    { key: "all", label: "All", count: counts.upcoming + counts.inprogress + counts.closed },
    { key: "upcoming", label: "Upcoming", count: counts.upcoming },
    { key: "inprogress", label: "In Progress", count: counts.inprogress },
    { key: "closed", label: "Past / Closed", count: counts.closed },
  ];

  if (loading) return <div className="text-gray-400 text-center py-10">Loading...</div>;

  return (
    <div>
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white">Exams ({total})</h2>
          <p className="text-gray-400 text-base mt-1">Exams you joined with a code. Join a new one from the dashboard.</p>
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-orange-400" />
          <input
            type="text"
            placeholder="Search exams..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full text-white placeholder:text-zinc-400 h-11 text-sm pl-10 rounded-none border-0 border-b border-white/20 bg-transparent px-0 transition-colors placeholder:text-zinc-500 focus:border-orange-500 focus:outline-none focus:ring-0"
          />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 flex-wrap mb-6">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setCategory(t.key)}
            className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition-all duration-200 border ${
              category === t.key
                ? "bg-orange-600 text-white border-orange-500 shadow-md shadow-orange-950/40"
                : "bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-white hover:bg-zinc-800"
            }`}
          >
            {t.label} ({t.count})
          </button>
        ))}
      </div>

      {exams.length === 0 ? (
        <Card className="bg-[#0f0f11] border-white/5 py-10 text-center">
          <CardContent>
            <FileText className="h-8 w-8 text-gray-500 mx-auto mb-3" />
            <p className="text-gray-400">
              {debouncedSearch ? `No exams found matching "${debouncedSearch}"` : "No exams found."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {exams.map((exam) => {
            const st = statusInfo(exam);
            return (
              <div
                key={exam.id}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 p-4 bg-[#0f0f11] border border-white/5 rounded-xl"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="h-9 w-9 bg-orange-600/20 text-orange-400 rounded-lg flex items-center justify-center border border-orange-500/30 shrink-0">
                    <FileText className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-white font-semibold text-sm truncate">{exam.title}</p>
                    <p className="text-gray-500 text-xs flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {exam.type === "SCHEDULED" && exam.startTime
                        ? `${formatDateTime(exam.startTime)} - ${exam.endTime ? formatDateTime(exam.endTime) : ""}`
                        : "On-demand"}
                      {" · "}{exam.totalMarks} marks
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-3 sm:shrink-0">
                  <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold border ${st.cls}`}>{st.label}</span>
                  {renderAction(exam)}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
    </div>
  );
}