"use client";

import React, { useEffect, useState } from "react";
import { FileText, Users, BarChart, Clock, ClipboardCheck, Activity, Loader } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

import { useRouter } from "next/navigation";
import { getTeacherOverviewStatsService } from "./exams/exam.service";
import { formatDate } from "@/lib/date";
import { toast } from "sonner";

export default function TeacherDashboard() {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await getTeacherOverviewStatsService();
        setStats(res.data || res);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchStats();
  }, []);

  if (loading) return <div className="p-4 sm:p-6 md:p-10 text-white text-center">Loading dashboard...</div>;

  const totalExams = stats?.totalExams || 0;
  const totalStudents = stats?.totalStudents || 0;
  const totalSubmissions = stats?.totalSubmissions || 0;
  const studentsOnline = stats?.studentsOnline || 0;
  const pendingEvaluations = stats?.pendingEvaluations || 0;
  const averageScore = stats?.averageScore || 0;
  const recentExams = stats?.recentExams || [];

  return (
    <div className="p-4 sm:p-6 md:p-10 flex flex-col gap-8 h-full overflow-y-auto custom-scrollbar">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold text-white tracking-tight">Dashboard</h2>
          <p className="text-gray-400 mt-1">Welcome back to your Institutional Portal.</p>
        </div>
      </header>

      <div className="grid grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4 md:gap-6">
        <Card className="bg-[#0f0f11] border-white/5">
          <CardHeader className="flex flex-row items-center justify-between gap-2 px-3 sm:px-6 pb-1 sm:pb-2">
            <CardTitle className="text-xs sm:text-sm font-medium leading-tight text-gray-400">Total Exams</CardTitle>
            <FileText className="h-4 w-4 text-orange-400" />
          </CardHeader>
          <CardContent className="px-3 sm:px-6">
            <div className="text-2xl font-bold text-white">{totalExams}</div>
            <p className="hidden sm:block text-xs text-gray-500 mt-1">Exams created by you</p>
          </CardContent>
        </Card>
        <Card className="bg-[#0f0f11] border-white/5">
          <CardHeader className="flex flex-row items-center justify-between gap-2 px-3 sm:px-6 pb-1 sm:pb-2">
            <CardTitle className="text-xs sm:text-sm font-medium leading-tight text-gray-400">Total Students</CardTitle>
            <Users className="h-4 w-4 text-orange-400" />
          </CardHeader>
          <CardContent className="px-3 sm:px-6">
            <div className="text-2xl font-bold text-white">{totalStudents}</div>
            <p className="hidden sm:block text-xs text-gray-500 mt-1">Students who attempted your exams</p>
          </CardContent>
        </Card>
        <Card className="bg-[#0f0f11] border-white/5">
          <CardHeader className="flex flex-row items-center justify-between gap-2 px-3 sm:px-6 pb-1 sm:pb-2">
            <CardTitle className="text-xs sm:text-sm font-medium leading-tight text-gray-400">Total Submissions</CardTitle>
            <ClipboardCheck className="h-4 w-4 text-orange-400" />
          </CardHeader>
          <CardContent className="px-3 sm:px-6">
            <div className="text-2xl font-bold text-white">{totalSubmissions}</div>
            <p className="hidden sm:block text-xs text-gray-500 mt-1">Across all your exams</p>
          </CardContent>
        </Card>
        <Card className="bg-[#0f0f11] border-white/5">
          <CardHeader className="flex flex-row items-center justify-between gap-2 px-3 sm:px-6 pb-1 sm:pb-2">
            <CardTitle className="text-xs sm:text-sm font-medium leading-tight text-gray-400">Students Online</CardTitle>
            <Activity className="h-4 w-4 text-emerald-400" />
          </CardHeader>
          <CardContent className="px-3 sm:px-6">
            <div className="text-2xl font-bold text-emerald-400">{studentsOnline}</div>
            <p className="hidden sm:block text-xs text-gray-500 mt-1">Currently attempting an exam</p>
          </CardContent>
        </Card>
        <Card className="bg-[#0f0f11] border-white/5">
          <CardHeader className="flex flex-row items-center justify-between gap-2 px-3 sm:px-6 pb-1 sm:pb-2">
            <CardTitle className="text-xs sm:text-sm font-medium leading-tight text-gray-400">Pending Evaluations</CardTitle>
            <Loader className="h-4 w-4 text-amber-400" />
          </CardHeader>
          <CardContent className="px-3 sm:px-6">
            <div className="text-2xl font-bold text-amber-400">{pendingEvaluations}</div>
            <p className="hidden sm:block text-xs text-gray-500 mt-1">Descriptive answers being graded</p>
          </CardContent>
        </Card>
        <Card className="bg-[#0f0f11] border-white/5">
          <CardHeader className="flex flex-row items-center justify-between gap-2 px-3 sm:px-6 pb-1 sm:pb-2">
            <CardTitle className="text-xs sm:text-sm font-medium leading-tight text-gray-400">Average Score</CardTitle>
            <BarChart className="h-4 w-4 text-orange-400" />
          </CardHeader>
          <CardContent className="px-3 sm:px-6">
            <div className="text-2xl font-bold text-white">{averageScore}%</div>
            <p className="hidden sm:block text-xs text-gray-500 mt-1">Across submitted exams</p>
          </CardContent>
        </Card>
      </div>

      <div className="mt-4">
        <h3 className="text-xl font-semibold text-white mb-4">Recent Exams</h3>
        {recentExams.length === 0 ? (
          <Card className="bg-[#0f0f11] border-white/5">
            <CardContent className="p-0">
               <div className="p-5 sm:p-8 text-center text-gray-500 text-sm">
                  No recent exams found. Click "Create New Exam" to get started.
               </div>
            </CardContent>
          </Card>
        ) : (
          <div className="flex flex-col gap-2">
            {recentExams.map((exam: any) => (
              <div
                key={exam.id || exam._id}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 p-4 bg-[#0f0f11] border border-white/5 rounded-xl hover:bg-[#12131a] hover:border-white/10 transition-all"
              >
                <div className="flex items-center gap-4 min-w-0">
                  <div className="h-10 w-10 bg-orange-600/20 text-orange-400 rounded-lg flex items-center justify-center border border-orange-500/30 shrink-0">
                    <FileText className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-white font-semibold text-sm truncate">{exam.title}</p>
                    <p className="text-gray-500 text-xs flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {exam.duration} mins · {exam.totalMarks} marks · Created {formatDate(exam.createdAt)}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3 sm:shrink-0">
                  <span className="text-[10px] font-bold px-2 py-1 rounded bg-white/5 text-gray-300 uppercase tracking-wider border border-white/5">
                    {exam.joinCode ? `CODE: ${exam.joinCode}` : "DRAFT"}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="bg-transparent border-white/10 text-gray-300 hover:text-white hover:bg-white/5"
                    onClick={() => router.push(`/teacher/exams/${exam.id || exam._id}/results`)}
                  >
                    Results
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="bg-transparent border-orange-500/30 text-orange-400 hover:text-orange-300 hover:bg-orange-500/10"
                    onClick={() => router.push(`/teacher/exams/${exam.id || exam._id}`)}
                  >
                    Manage
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
