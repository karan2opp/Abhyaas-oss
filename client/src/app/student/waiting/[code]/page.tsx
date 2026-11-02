"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, Loader2 } from "lucide-react";
import { verifyJoinCodeService, joinExamService } from "@/app/student/student.service";

// Splits the time left into the units shown on the timer. Days only appear when the exam is more than a day away.
const timeParts = (seconds: number) => {
  const days = Math.floor(seconds / 86400);
  const parts = [
    { value: Math.floor((seconds % 86400) / 3600), unit: "hours" },
    { value: Math.floor((seconds % 3600) / 60), unit: "minutes" },
    { value: seconds % 60, unit: "seconds" },
  ];
  return days > 0 ? [{ value: days, unit: "days" }, ...parts] : parts;
};

export default function WaitingRoomPage() {
  const params = useParams();
  const joinCode = params.code as string;
  const router = useRouter();

  // When the exam starts, as a timestamp; null while loading.
  const [startsAt, setStartsAt] = useState<number | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [joinFailed, setJoinFailed] = useState(false);
  const joiningRef = useRef(false);

  const joinExam = useCallback(async () => {
    if (joiningRef.current) return;
    joiningRef.current = true;
    setJoinFailed(false);
    try {
      const res = await joinExamService(joinCode);
      const submissionId = res.data?.submission?.id || res.submission?.id;
      router.push(submissionId ? `/student/exams/${submissionId}` : "/student");
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Failed to join exam");
      joiningRef.current = false;
      setJoinFailed(true);
    }
  }, [joinCode, router]);

  useEffect(() => {
    if (!joinCode) return;
    verifyJoinCodeService(joinCode)
      .then((res) => {
        const exam = res.data || res;
        setStartsAt(exam.startTime ? new Date(exam.startTime).getTime() : Date.now());
      })
      .catch((err: any) => {
        toast.error(err.response?.data?.message || "Invalid or expired join code");
        router.push("/student");
      });
  }, [joinCode, router]);

  // Counts down against the real start time, so the timer stays right even if the tab was in the background.
  useEffect(() => {
    if (startsAt === null) return;
    const tick = () => {
      const left = Math.max(0, Math.ceil((startsAt - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left === 0) joinExam();
      return left;
    };
    if (tick() === 0) return;
    const timer = setInterval(() => {
      if (tick() === 0) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [startsAt, joinExam]);

  return (
    <div className="relative flex w-full flex-1 flex-col items-center justify-center px-4 pb-[10vh] text-center">
      <button
        onClick={() => router.push("/student")}
        className="absolute left-4 top-4 flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-gray-400 transition-colors hover:bg-white/5 hover:text-white sm:left-6 sm:top-6"
      >
        <ArrowLeft className="h-4 w-4" /> Back
      </button>
      {secondsLeft === null ? (
        <Loader2 className="h-6 w-6 animate-spin text-orange-500" />
      ) : secondsLeft > 0 ? (
        <>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-500">Starts in</p>
          <div className="mt-6 flex items-start justify-center gap-5 sm:gap-10">
            {timeParts(secondsLeft).map((part) => (
              <div key={part.unit} className="flex flex-col items-center">
                <span className="text-5xl font-bold tabular-nums text-white sm:text-7xl">{String(part.value).padStart(2, "0")}</span>
                <span className="mt-2 text-[11px] font-medium uppercase tracking-wider text-gray-500">{part.unit}</span>
              </div>
            ))}
          </div>
        </>
      ) : joinFailed ? (
        <button onClick={joinExam} className="rounded-xl bg-orange-600 px-6 py-3 text-sm font-bold text-white transition-colors hover:bg-orange-700">
          Enter exam
        </button>
      ) : (
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <Loader2 className="h-4 w-4 animate-spin text-orange-500" /> Starting your exam…
        </div>
      )}
    </div>
  );
}
