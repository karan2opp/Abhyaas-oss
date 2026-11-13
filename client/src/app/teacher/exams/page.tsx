"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Plus, Search, Clock, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { getExamsService, deleteExamService, updateExamService } from "./exam.service";
import { formatDateTime } from "@/lib/date";
import { TeacherExamPreviewModal } from "@/components/TeacherExamPreviewModal";
import { Pagination } from "@/components/Pagination";

interface ExamEntry {
  id: string;
  title: string;
  type: "SCHEDULED" | "ON_DEMAND";
  totalMarks: number;
  joinCode: string;
  startTime: string | null;
  endTime: string | null;
  publishTime: string | null;
  duration: number;
  createdAt: string;
  subject?: string;
}

export default function ExamsPage() {
  const router = useRouter();

  const [exams, setExams] = useState<ExamEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "published" | "draft">("all");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState({ all: 0, published: 0, draft: 0 });
  const PAGE_SIZE = 9;

  // Preview Modal State
  const [previewExamId, setPreviewExamId] = useState<string | null>(null);

  // Debounce search input to avoid hitting backend on every keystroke
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(search);
    }, 300);
    return () => clearTimeout(handler);
  }, [search]);

  const loadExams = async (query: string, status: string, pg: number) => {
    try {
      setLoading(true);
      const res = await getExamsService({ search: query, status, page: pg, limit: PAGE_SIZE });
      const result = res.data || { data: [], total: 0, counts: { all: 0, published: 0, draft: 0 } };
      setExams(result.data || []);
      setTotal(result.total || 0);
      setCounts(result.counts || { all: 0, published: 0, draft: 0 });
      setTotalPages(Math.max(1, Math.ceil((result.total || 0) / PAGE_SIZE)));
    } catch {
      toast.error("Failed to load exams");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, statusFilter]);

  useEffect(() => {
    loadExams(debouncedSearch, statusFilter, page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, statusFilter, page]);

  const handleDeleteExam = async (examId: string, title: string) => {
    if (!confirm(`Delete exam "${title}"? This permanently deletes its sections, questions, and submissions. This cannot be undone.`)) return;
    try {
      await deleteExamService(examId);
      toast.success("Exam deleted");
      loadExams(debouncedSearch, statusFilter, page);
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Failed to delete exam");
    }
  };

  const handleTogglePublish = async (examId: string, currentStatus: string) => {
    const nextStatus = currentStatus === "PUBLISHED" ? "DRAFT" : "PUBLISHED";
    try {
      await updateExamService(examId, { status: nextStatus });
      toast.success(nextStatus === "PUBLISHED" ? "Exam published successfully!" : "Exam moved back to Draft");
      loadExams(debouncedSearch, statusFilter, page);
    } catch (err: any) {
      toast.error(err.response?.data?.message || err.message || "Failed to update status");
    }
  };

  const allCount = counts.all;
  const publishedCount = counts.published;
  const draftCount = counts.draft;

  return (
    <div className="space-y-6 p-4 sm:p-6 md:p-10">
      {/* Header and Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-xl font-bold text-white tracking-tight">Exams</h3>
          <p className="text-gray-400 text-sm mt-1">Students join an exam with its join code.</p>
        </div>
        <Button
          className="bg-orange-600 hover:bg-orange-700 text-white font-semibold shadow-lg shadow-orange-950/40 shrink-0"
          onClick={() => router.push(`/teacher/exams/new`)}
        >
          <Plus className="mr-2 h-4 w-4" /> New Exam
        </Button>
      </div>

      {/* Search Input Bar & Status Filter Pills */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="relative max-w-md w-full">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-orange-400" />
          <Input
            type="text"
            placeholder="Search exams by title..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="text-white placeholder:text-zinc-400 h-11 text-sm transition-all pl-10"
          />
        </div>

        {/* Filter Pills */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setStatusFilter("all")}
            className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition-all duration-200 border ${
              statusFilter === "all"
                ? "bg-orange-600 text-white border-orange-500 shadow-md shadow-orange-950/40"
                : "bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-white hover:bg-zinc-800"
            }`}
          >
            All ({allCount})
          </button>
          <button
            onClick={() => setStatusFilter("published")}
            className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition-all duration-200 border ${
              statusFilter === "published"
                ? "bg-orange-600 text-white border-orange-500 shadow-md shadow-orange-950/40"
                : "bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-white hover:bg-zinc-800"
            }`}
          >
            Published ({publishedCount})
          </button>
          <button
            onClick={() => setStatusFilter("draft")}
            className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition-all duration-200 border ${
              statusFilter === "draft"
                ? "bg-orange-600 text-white border-orange-500 shadow-md shadow-orange-950/40"
                : "bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-white hover:bg-zinc-800"
            }`}
          >
            Draft ({draftCount})
          </button>
        </div>
      </div>

      {/* Main Grid View */}
      {loading ? (
        <div className="text-gray-400 text-center py-12">Loading exams...</div>
      ) : exams.length === 0 ? (
        <Card className="bg-[#09090b] border-zinc-800 py-12 text-center rounded-2xl">
          <CardContent>
            <FileText className="h-10 w-10 text-gray-500 mx-auto mb-3" />
            <p className="text-gray-400 text-base font-medium">
              {debouncedSearch ? `No exams found matching "${debouncedSearch}"` : `No ${statusFilter === "all" ? "" : statusFilter} exams found.`}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {exams.map((e) => (
            <div
              key={e.id}
              className="bg-[#12131a] border border-white/10 hover:border-orange-500/50 rounded-2xl p-4 sm:p-6 relative flex flex-col justify-between shadow-2xl transition-all duration-300 group"
            >
              <div>
                {/* Main Title */}
                <h3 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight mb-1.5 leading-snug" title={e.title}>
                  {e.title}
                </h3>

                <p className="text-xs text-zinc-500 mb-4">
                  Join code: <span className="font-mono font-semibold tracking-widest text-orange-300">{e.joinCode}</span>
                </p>

                {/* Timeline Section */}
                <div className="space-y-2.5 mb-5 text-sm text-white">
                  <div className="flex items-center gap-2 text-zinc-200 font-semibold mb-1">
                    <Clock className="h-4.5 w-4.5 text-orange-400 shrink-0" />
                    <span className="text-sm">Timeline & Details</span>
                  </div>
                  <div className="space-y-1.5 text-sm pl-1">
                    <p className="text-zinc-400">
                      • Start: <span className="text-zinc-200 font-medium">{e.startTime ? formatDateTime(e.startTime) : "Immediate / On-demand"}</span>
                    </p>
                    <p className="text-zinc-400">
                      • Due: <span className="text-zinc-200 font-medium">{e.endTime ? formatDateTime(e.endTime) : "Flexible"}</span>
                    </p>
                    <p className="text-zinc-400">
                      • Duration: <span className="text-orange-300 font-medium">{e.duration} mins</span>
                    </p>
                    <p className="text-zinc-400">
                      • Status:{" "}
                      <button
                        onClick={() => handleTogglePublish(e.id, (e as any).status)}
                        title="Click to toggle Published / Draft status"
                        className={`font-medium cursor-pointer hover:underline underline-offset-2 ${
                          (e as any).status === "PUBLISHED" ? "text-emerald-300" : "text-amber-300"
                        }`}
                      >
                        {(e as any).status === "PUBLISHED" ? "Published" : "Draft"}
                      </button>
                    </p>
                  </div>
                </div>
              </div>

              {/* Actions Bottom Bar */}
              {/* Even 2 x 2 grid: Edit / Preview on top, Results / Delete below. */}
              <div className="grid grid-cols-2 gap-2 pt-4 border-t border-white/10 mt-2">
                <Button
                  size="sm"
                  className="h-9 w-full bg-zinc-800/90 hover:bg-zinc-700 text-white border border-zinc-700 text-sm font-semibold rounded-xl transition-all"
                  onClick={() => router.push(`/teacher/exams/${e.id}`)}
                >
                  Edit
                </Button>
                <Button
                  size="sm"
                  className="h-9 w-full bg-zinc-800/90 hover:bg-zinc-700 text-orange-300 hover:text-white border border-orange-500/30 text-sm font-semibold rounded-xl transition-all"
                  onClick={() => setPreviewExamId(e.id)}
                >
                  <Eye className="mr-1.5 h-4 w-4 text-orange-400" /> Preview
                </Button>
                <Button
                  size="sm"
                  className="h-9 w-full bg-orange-600 hover:bg-orange-700 text-white font-semibold text-sm rounded-xl shadow-md shadow-orange-950/40 transition-all"
                  onClick={() => router.push(`/teacher/exams/${e.id}/results`)}
                >
                  Results
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-9 w-full bg-transparent border-red-500/20 text-red-400 hover:bg-red-500/10 rounded-xl font-semibold text-sm"
                  onClick={() => handleDeleteExam(e.id, e.title)}
                  title="Delete exam"
                >
                  Delete
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />

      {/* Student View Preview Modal */}
      {previewExamId && (
        <TeacherExamPreviewModal
          examId={previewExamId}
          onClose={() => setPreviewExamId(null)}
        />
      )}
    </div>
  );
}
