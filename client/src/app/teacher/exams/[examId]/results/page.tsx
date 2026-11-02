"use client"; 

import React, { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ChevronLeft, Users, CheckCircle, AlertCircle, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getExamByIdService, getExamSubmissionsService } from "@/app/teacher/exams/exam.service";
import { formatDateTime } from "@/lib/date";

export default function ExamResultsPage() {
  const params = useParams();
  const router = useRouter();
  const examId = params.examId as string;

  const [exam, setExam] = useState<any>(null);
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchResults = async () => {
      try {
        const [examRes, subsRes] = await Promise.all([
          getExamByIdService(examId),
          getExamSubmissionsService(examId)
        ]);
        setExam(examRes.data || examRes);
        setSubmissions(subsRes.data || subsRes);
      } catch (error) {
        console.error("Failed to load results", error);
      } finally {
        setLoading(false);
      }
    };
    if (examId) fetchResults();
  }, [examId]);

  if (loading) {
    return <div className="p-4 sm:p-6 md:p-10 text-white text-center">Loading results...</div>;
  }

  const totalSubmissions = submissions.length;
  
  // Calculate stats based on submitted exams
  const submittedExams = submissions.filter(s => s.submission.status === "submitted" || s.submission.status === "timeout");
  const averageScore = submittedExams.length > 0 
    ? submittedExams.reduce((acc, curr) => acc + (curr.submission.score || 0), 0) / submittedExams.length
    : 0;
  
  const highestScore = submittedExams.length > 0
    ? Math.max(...submittedExams.map(s => s.submission.score || 0))
    : 0;

  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar p-4 sm:p-6 md:p-10">
      <header className="flex items-center justify-between mb-8">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <Button 
              variant="outline" 
              size="sm" 
              className="bg-transparent border-white/10 text-gray-400 hover:text-white"
              onClick={() => router.push(`/teacher/exams`)}
            >
              <ChevronLeft className="mr-1 h-4 w-4" /> Back to Exams
            </Button>
            <Button 
              size="sm" 
              className="bg-yellow-600 hover:bg-yellow-700 text-white font-semibold"
              onClick={() => router.push(`/teacher/exams/${examId}/leaderboard`)}
            >
              <Trophy className="mr-2 h-4 w-4" /> View Leaderboard
            </Button>
          </div>
          <h2 className="text-3xl font-bold text-white tracking-tight">{exam?.title || "Exam"} Results</h2>
          <p className="text-gray-400 mt-1">View all student submissions and scores.</p>
        </div>
      </header>

      {/* Stats Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
        <Card className="bg-[#0f0f11] border-white/5">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-gray-400">Total Submissions</CardTitle>
            <Users className="h-4 w-4 text-orange-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-white">{totalSubmissions}</div>
          </CardContent>
        </Card>
        <Card className="bg-[#0f0f11] border-white/5">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-gray-400">Average Score</CardTitle>
            <CheckCircle className="h-4 w-4 text-orange-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-white">
              {averageScore.toFixed(1)} <span className="text-sm text-gray-500 font-normal">/ {exam?.totalMarks || 100}</span>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-[#0f0f11] border-white/5">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-gray-400">Highest Score</CardTitle>
            <AlertCircle className="h-4 w-4 text-green-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-white">
              {highestScore} <span className="text-sm text-gray-500 font-normal">/ {exam?.totalMarks || 100}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Results Table */}
      <Card className="bg-[#0f0f11]/80 border-white/5 shadow-2xl backdrop-blur-xl rounded-xl">
        <CardHeader className="border-b border-white/5 pb-4">
          <CardTitle className="text-xl font-bold text-white">Student Submissions</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {submissions.length === 0 ? (
            <div className="p-4 sm:p-6 md:p-10 text-center text-gray-500">
              No students have joined or submitted this exam yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-gray-300">
                <thead className="bg-[#050505]/50 text-gray-400 font-semibold border-b border-white/5">
                  <tr>
                    <th className="px-6 py-4">Student Name</th>
                    <th className="px-6 py-4">Email Address</th>
                    <th className="px-6 py-4">Status</th>
                    <th className="px-6 py-4">Score</th>
                    <th className="px-6 py-4">Submitted At</th>
                    <th className="px-6 py-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {submissions.map((row) => (
                    <tr key={row.submission.id} className="hover:bg-white/5 transition-colors">
                      <td className="px-6 py-4 font-medium text-white">{row.user.name}</td>
                      <td className="px-6 py-4 text-gray-400">{row.user.email}</td>
                      <td className="px-6 py-4">
                        {row.submission.status === "submitted" && <span className="px-2 py-1 bg-green-500/10 text-green-400 rounded text-xs font-bold uppercase tracking-wider border border-green-500/20">Submitted</span>}
                        {row.submission.status === "evaluating" && <span className="px-2 py-1 bg-orange-500/10 text-orange-400 rounded text-xs font-bold uppercase tracking-wider border border-orange-500/30">Evaluating</span>}
                        {row.submission.status === "timeout" && <span className="px-2 py-1 bg-yellow-500/10 text-yellow-400 rounded text-xs font-bold uppercase tracking-wider border border-yellow-500/20">Timeout</span>}
                        {row.submission.status === "inprogress" && <span className="px-2 py-1 bg-orange-500/10 text-orange-400 rounded text-xs font-bold uppercase tracking-wider border border-orange-500/30">In Progress</span>}
                      </td>
                      <td className="px-6 py-4 font-bold text-white">
                        {row.submission.score !== null ? row.submission.score : "-"}
                      </td>
                      <td className="px-6 py-4 text-gray-500">
                        {row.submission.submittedAt
                          ? formatDateTime(row.submission.submittedAt)
                          : "Not yet"}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="text-orange-400 hover:text-orange-300 hover:bg-orange-500/10"
                          onClick={() => router.push(`/teacher/exams/${examId}/results/${row.submission.id}`)}
                        >
                          View Details
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
