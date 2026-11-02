"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ClipboardList, Layers, Lock, Search, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { getMyAssignmentsService, joinAssignmentByCodeService } from "@/app/student/assignments/assignment.service";
import { formatDateTime } from "@/lib/date";

interface AssignmentEntry {
  id: string;
  title: string;
  totalMarks: number;
  startDate: string | null;
  dueDate: string | null;
  sequenceOrder: number | null;
  seriesId: string | null;
  locked: boolean;
  unlocksAt: string | null;
  reason: "time" | "previous_incomplete" | null;
  submissionStatus: "in_progress" | "submitted" | "graded" | "evaluating" | null;
}

type View = "landing" | "weekly" | "standard";
type DateStatus = "live" | "upcoming" | "past";
type StatusFilter = DateStatus | "submitted";

const classifyStatus = (a: AssignmentEntry): DateStatus => {
  const now = new Date();
  if (a.startDate && now < new Date(a.startDate)) return "upcoming";
  if (a.dueDate && now > new Date(a.dueDate)) return "past";
  return "live";
};

const isSubmitted = (a: AssignmentEntry) =>
  a.submissionStatus === "submitted" ||
  a.submissionStatus === "graded" ||
  a.submissionStatus === "evaluating";

export default function StudentAssignmentsPage() {
  const router = useRouter();

  const [assignments, setAssignments] = useState<AssignmentEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [joinCode, setJoinCode] = useState("");
  const [isJoining, setIsJoining] = useState(false);

  const [view, setView] = useState<View>("landing");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("live");

  const loadAssignments = async () => {
    setLoading(true);
    try {
      const aRes = await getMyAssignmentsService();
      const sorted = [...(aRes.data || [])].sort((a, b) => {
        if (a.sequenceOrder && b.sequenceOrder) return a.sequenceOrder - b.sequenceOrder;
        if (a.sequenceOrder) return -1;
        if (b.sequenceOrder) return 1;
        return 0;
      });
      setAssignments(sorted);
    } catch {
      toast.error("Failed to load assignments");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAssignments();
  }, []);

  // The code can be a single assignment's or a whole series'; either way the
  // new work shows up in the list below once joined.
  const handleJoin = async () => {
    if (!joinCode.trim()) return;
    setIsJoining(true);
    try {
      const res = await joinAssignmentByCodeService(joinCode.trim().toUpperCase());
      toast.success(`Joined "${res.data?.title ?? "assignment"}"`);
      setJoinCode("");
      await loadAssignments();
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Failed to join");
    } finally {
      setIsJoining(false);
    }
  };

  const weekly = useMemo(() => assignments.filter((a) => a.seriesId), [assignments]);
  const standard = useMemo(() => assignments.filter((a) => !a.seriesId), [assignments]);
  const bucket = view === "weekly" ? weekly : view === "standard" ? standard : [];

  const counts = useMemo(() => {
    const c = { live: 0, upcoming: 0, past: 0, submitted: 0 };
    bucket.forEach((a) => {
      c[classifyStatus(a)]++;
      if (isSubmitted(a)) c.submitted++;
    });
    return c;
  }, [bucket]);

  const visible = bucket
    .filter((a) => (status === "submitted" ? isSubmitted(a) : classifyStatus(a) === status))
    .filter((a) => a.title.toLowerCase().includes(search.toLowerCase()));

  const openView = (v: View) => {
    setView(v);
    setSearch("");
    setStatus("live");
  };

  if (loading) return <div className="text-gray-400 text-center py-10">Loading...</div>;

  if (view === "landing") {
    return (
      <div>
        <div className="mb-6">
          <h2 className="text-2xl font-bold text-white">Assignments ({assignments.length})</h2>
          <p className="text-gray-400 text-base mt-1">Enter a code from your teacher to join an assignment or a series.</p>
        </div>

        <div className="flex gap-4 mb-6">
          <input
            type="text"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleJoin()}
            placeholder="enter the join code"
            className="text-white placeholder:text-zinc-400 p-2.5 w-full max-w-sm transition-all rounded-none border-0 border-b border-white/20 bg-transparent px-0 transition-colors placeholder:text-zinc-500 focus:border-orange-500 focus:outline-none focus:ring-0"
          />
          <button
            className="bg-orange-600 hover:bg-orange-700 text-white font-semibold px-6 py-2.5 rounded-lg transition-all shadow-lg shadow-orange-950/40 disabled:opacity-60"
            onClick={handleJoin}
            disabled={isJoining}
          >
            {isJoining ? "Joining..." : "Join"}
          </button>
        </div>

        {assignments.length === 0 ? (
          <Card className="bg-[#0f0f11] border-white/5 py-10 text-center">
            <CardContent>
              <ClipboardList className="h-8 w-8 text-gray-500 mx-auto mb-3" />
              <p className="text-gray-400">No assignments available yet.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Card
              onClick={() => openView("weekly")}
              className="bg-[#0f0f11] border-white/5 hover:border-white/10 transition-all cursor-pointer"
            >
              <CardContent className="p-6">
                <div className="h-10 w-10 bg-orange-600/20 text-orange-400 rounded-lg flex items-center justify-center border border-orange-500/30 mb-3">
                  <Layers className="h-5 w-5" />
                </div>
                <p className="text-white font-semibold text-base">Weekly Assignments</p>
                <p className="text-gray-500 text-sm mt-1">{weekly.length} assignment{weekly.length === 1 ? "" : "s"} in an ordered series.</p>
              </CardContent>
            </Card>
            <Card
              onClick={() => openView("standard")}
              className="bg-[#0f0f11] border-white/5 hover:border-white/10 transition-all cursor-pointer"
            >
              <CardContent className="p-6">
                <div className="h-10 w-10 bg-orange-600/20 text-orange-400 rounded-lg flex items-center justify-center border border-orange-500/30 mb-3">
                  <ClipboardList className="h-5 w-5" />
                </div>
                <p className="text-white font-semibold text-base">Standard Assignments</p>
                <p className="text-gray-500 text-sm mt-1">{standard.length} one-off assignment{standard.length === 1 ? "" : "s"}.</p>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <button
        onClick={() => setView("landing")}
        className="flex items-center gap-1.5 text-gray-400 hover:text-white text-sm mb-4 transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Assignments
      </button>

      <div className="mb-6">
        <h3 className="text-2xl font-bold text-white">{view === "weekly" ? "Weekly Assignments" : "Standard Assignments"}</h3>
      </div>

      <div className="relative max-w-md mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-orange-400" />
        <input
          type="text"
          placeholder="Search assignments..."
          value={search}
          onChange={(e) => setSearch(e.target.value)} className="text-white placeholder:text-zinc-400 h-11 text-sm transition-all pl-10 rounded-none border-0 border-b border-white/20 bg-transparent px-0 transition-colors placeholder:text-zinc-500 focus:border-orange-500 focus:outline-none focus:ring-0"
        />
      </div>

      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {(
          [
            ["live", "Live", counts.live],
            ["upcoming", "Upcoming", counts.upcoming],
            ["past", "Past", counts.past],
            ["submitted", "Submitted", counts.submitted],
          ] as [StatusFilter, string, number][]
        ).map(([key, label, count]) => (
          <button
            key={key}
            onClick={() => setStatus(key)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
              status === key ? "bg-orange-500/20 border-orange-500/50 text-sky-200 font-medium" : "bg-transparent border-white/10 text-white/70 hover:bg-white/5"
            }`}
          >
            {label} ({count})
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <Card className="bg-[#0f0f11] border-white/5 py-10 text-center">
          <CardContent>
            <ClipboardList className="h-8 w-8 text-gray-500 mx-auto mb-3" />
            <p className="text-gray-400">No {status} assignments here.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {visible.map((a) => (
            <Card key={a.id} className={`border-white/5 ${a.locked ? "bg-[#0f0f11]/50" : "bg-[#0f0f11]"}`}>
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-3 mb-1">
                  <p className={`font-semibold text-base ${a.locked ? "text-gray-500" : "text-white"}`}>
                    {a.sequenceOrder && `#${a.sequenceOrder}: `}{a.title}
                  </p>
                  {a.locked ? (
                    <Lock className="h-4 w-4 text-gray-500 shrink-0 mt-0.5" />
                  ) : (
                    <span
                      className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border shrink-0 ${
                        a.submissionStatus === "submitted" || a.submissionStatus === "graded"
                          ? "bg-[#18181b]merald-600/10 text-emerald-400 border-emerald-500/20"
                          : a.submissionStatus === "evaluating"
                          ? "bg-orange-500/10 text-orange-400 border-orange-500/30 animate-pulse"
                          : "bg-[#18181b]mber-500/10 text-amber-400 border-amber-500/20"
                      }`}
                    >
                      {a.submissionStatus === "submitted" || a.submissionStatus === "graded"
                        ? "Submitted"
                        : a.submissionStatus === "evaluating"
                        ? "Evaluating"
                        : "Pending"}
                    </span>
                  )}
                </div>

                <div className="p-4 bg-[#161b28] border border-white/10 rounded-xl mb-4">
                  <p className="flex items-center gap-1.5 text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
                    <Clock className="h-3.5 w-3.5" /> Timeline
                  </p>
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
                </div>

                <div className="flex items-center justify-between">
                  <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-[#18181b]merald-600/10 text-emerald-400 border border-emerald-500/20">
                    {a.totalMarks} marks
                  </span>
                  <Button
                    size="lg"
                    className="bg-orange-600 hover:bg-orange-700 text-white disabled:opacity-40 px-6"
                    onClick={() => router.push(`/student/assignments/${a.id}`)}
                    disabled={a.locked}
                  >
                    {a.locked ? "Locked" : "Open"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
