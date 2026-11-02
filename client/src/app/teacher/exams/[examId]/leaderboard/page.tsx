"use client";

import { useParams } from "next/navigation";
import { LeaderboardView } from "@/components/LeaderboardView";

export default function TeacherLeaderboardPage() {
  const params = useParams();
  const examId = params.examId as string;

  return (
    <LeaderboardView
      examId={examId}
    />
  );
}
