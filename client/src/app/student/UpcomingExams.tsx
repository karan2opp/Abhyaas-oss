"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, Clock } from "lucide-react";
import { getUpcomingExamsService } from "./student.service";
import { formatDateTime } from "@/lib/date";

type UpcomingExam = {
  id: string;
  title: string;
  startTime: string | null;
  joinCode: string;
};

const countdown = (ms: number) => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  return `${minutes}m ${seconds}s`;
};

/**
 * Exams the student has already entered the join code for but not started yet. Each shows its countdown and a Join
 * button that opens the waiting page, so the code never has to be typed again. Shows nothing when there are none.
 */
export function UpcomingExams() {
  const router = useRouter();
  const [exams, setExams] = useState<UpcomingExam[]>([]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    getUpcomingExamsService()
      .then((res) => setExams(res.data || []))
      .catch(() => {});
  }, []);

  // Keeps the countdowns ticking.
  useEffect(() => {
    if (exams.length === 0) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [exams.length]);

  if (exams.length === 0) return null;

  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-xl font-semibold text-white">Upcoming</h3>
      <div className="flex flex-col gap-3">
        {exams.map((exam) => {
          const startMs = exam.startTime ? new Date(exam.startTime).getTime() : null;
          const left = startMs === null ? 0 : startMs - now;
          return (
            <div key={exam.id} className="flex flex-col gap-4 rounded-xl border border-white/5 bg-[#0f0f11] p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 space-y-1.5">
                <h4 className="truncate text-[15px] font-bold leading-tight text-white" title={exam.title}>
                  {exam.title}
                </h4>
                {exam.startTime && (
                  <p className="flex items-center gap-2 text-[13px] text-gray-400">
                    <CalendarDays className="h-4 w-4 shrink-0" /> {formatDateTime(new Date(exam.startTime))}
                  </p>
                )}
              </div>
              <div className="flex items-center justify-between gap-4 sm:justify-end sm:gap-6">
                <p className="flex items-center gap-2 text-sm font-semibold tabular-nums text-orange-400">
                  <Clock className="h-4 w-4 shrink-0" />
                  {left > 0 ? `Starts in ${countdown(left)}` : "Started"}
                </p>
                <button
                  onClick={() => router.push(`/student/waiting/${exam.joinCode}`)}
                  className="h-9 rounded-lg bg-orange-600 px-5 text-[13px] font-semibold text-white transition-colors hover:bg-orange-700"
                >
                  Join
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
