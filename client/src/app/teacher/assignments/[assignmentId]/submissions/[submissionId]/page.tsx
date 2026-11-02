"use client";

import React, { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  getAssignmentByIdService,
  getSubmissionByIdService,
  getSubmissionsForAssignmentService,
  getQuestionsService,
  gradeSubmissionService,
} from "@/app/teacher/assignments/assignment.service";
import { formatDateTime } from "@/lib/date";

interface Answer {
  id: string;
  questionId: string;
  options: string[] | null;
  textAnswer: string | null;
  marksAwarded: number | null;
  feedback: string | null;
}

interface Question {
  id: string;
  type: "mcq" | "descriptive";
  description: string;
  marks: number;
  modelAnswer: string | null;
  options: { id: string; value: string; isCorrect: boolean }[];
}

interface Submission {
  id: string;
  status: string;
  submittedAt: string | null;
  isLate: boolean;
  totalMarksAwarded: number | null;
  overallFeedback: string | null;
  answers: Answer[];
}

export default function GradeSubmissionPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const assignmentId = params.assignmentId as string;
  const submissionId = params.submissionId as string;
  const returnTo = searchParams.get("returnTo");

  const [submission, setSubmission] = useState<Submission | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [assignmentTitle, setAssignmentTitle] = useState("");
  const [totalMarks, setTotalMarks] = useState(0);
  const [studentName, setStudentName] = useState("");
  const [studentEmail, setStudentEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [marksByAnswer, setMarksByAnswer] = useState<Record<string, string>>({});
  const [feedbackByAnswer, setFeedbackByAnswer] = useState<Record<string, string>>({});
  const [overallFeedback, setOverallFeedback] = useState("");

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [subRes, qRes, listRes, aRes] = await Promise.all([
          getSubmissionByIdService(submissionId),
          getQuestionsService(assignmentId),
          getSubmissionsForAssignmentService(assignmentId),
          getAssignmentByIdService(assignmentId),
        ]);
        const sub: Submission = subRes.data;
        setSubmission(sub);
        setQuestions(qRes.data || []);
        setOverallFeedback(sub.overallFeedback || "");
        setAssignmentTitle(aRes.data?.title || "");
        setTotalMarks(aRes.data?.totalMarks || 0);

        const marks: Record<string, string> = {};
        const feedback: Record<string, string> = {};
        sub.answers.forEach((a) => {
          marks[a.id] = a.marksAwarded !== null ? String(a.marksAwarded) : "";
          feedback[a.id] = a.feedback || "";
        });
        setMarksByAnswer(marks);
        setFeedbackByAnswer(feedback);

        const found = (listRes.data || []).find((s: any) => s.id === submissionId);
        if (found) {
          setStudentName(found.studentName);
          setStudentEmail(found.studentEmail);
        }
      } catch {
        toast.error("Failed to load submission");
      } finally {
        setLoading(false);
      }
    })();
  }, [submissionId, assignmentId]);

  const getQuestion = (questionId: string) => questions.find((q) => q.id === questionId);

  const handleSubmitGrade = async () => {
    if (!submission) return;
    for (const a of submission.answers) {
      const val = marksByAnswer[a.id];
      if (val === undefined || val === "" || isNaN(parseFloat(val))) {
        toast.error("Enter marks for every question before submitting");
        return;
      }
      const parsed = parseFloat(val);
      const q = getQuestion(a.questionId);
      if (parsed < 0 || (q && parsed > q.marks)) {
        toast.error(`Marks for "${q?.description.slice(0, 40)}..." cannot exceed ${q?.marks}`);
        return;
      }
    }

    setSaving(true);
    try {
      await gradeSubmissionService(submissionId, {
        answers: submission.answers.map((a) => ({
          answerId: a.id,
          marksAwarded: parseFloat(marksByAnswer[a.id]!),
          feedback: feedbackByAnswer[a.id] || undefined,
        })),
        overallFeedback: overallFeedback.trim() || undefined,
      });
      toast.success("Submission graded");
      router.push(`/teacher/assignments/${assignmentId}`);
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Failed to grade submission");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="text-gray-400 text-center py-10">Loading submission...</div>;
  if (!submission) return <div className="text-gray-400 text-center py-10">Submission not found</div>;

  if (submission.status === "in_progress") {
    return (
      <div className="text-white text-center py-10">
        This student hasn't submitted the assignment yet — nothing to grade.
      </div>
    );
  }

  if (submission.status === "evaluating") {
    return (
      <div className="text-white text-center py-10 animate-pulse">
        This submission is currently being evaluated by the AI grading engine. Please wait or refresh in a few moments.
      </div>
    );
  }

  return (
    <div>
      <button
        onClick={() => router.push(returnTo || `/teacher/assignments/${assignmentId}`)}
        className="flex items-center gap-2 text-gray-400 hover:text-white text-sm mb-6 transition-colors"
      >
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      <div className="bg-[#0b0e14] border border-white/10 rounded-2xl p-5 sm:p-8">
        <div className="pb-6 mb-6 border-b border-white/10 text-center">
          <h2 className="text-2xl md:text-3xl font-bold text-white tracking-tight">{assignmentTitle || "Assignment"}</h2>
        </div>

        <div className={`grid grid-cols-1 ${submission.status === "graded" ? "sm:grid-cols-3" : "sm:grid-cols-2"} gap-3 mb-8`}>
          <div className="bg-[#161b28] border border-white/10 rounded-lg p-4">
            <p className="text-[11px] text-orange-300 font-semibold uppercase tracking-wide mb-1.5">Submitted By</p>
            <p className="text-sm font-semibold text-white truncate">{studentName || "Student"}</p>
            <p className="text-xs text-gray-300 mt-0.5 truncate">{studentEmail}</p>
          </div>
          <div className="bg-[#161b28] border border-white/10 rounded-lg p-4">
            <p className="text-[11px] text-orange-300 font-semibold uppercase tracking-wide mb-1.5">Submitted On</p>
            <p className="text-sm font-semibold text-white">{submission.submittedAt ? formatDateTime(submission.submittedAt) : "—"}</p>
            {submission.isLate && <p className="text-xs text-amber-400 mt-0.5">Late submission</p>}
          </div>
          {submission.status === "graded" && (
            <div className="bg-[#161b28] border border-white/10 rounded-lg p-4">
              <p className="text-[11px] text-gray-400 font-semibold uppercase tracking-wide mb-1.5">Total Marks</p>
              <p className="text-sm font-semibold text-emerald-400">{submission.totalMarksAwarded}/{totalMarks}</p>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-6">
          {submission.answers.map((a, idx) => {
            const q = getQuestion(a.questionId);
            if (!q) return null;
            return (
              <div key={a.id}>
                <div className="flex items-start justify-between gap-4 mb-3">
                  <p className="text-white text-base font-medium leading-relaxed">
                    <span className="font-bold">Q{idx + 1}:</span> {q.description}
                  </p>
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-white/5 text-gray-300 border border-white/10 shrink-0 whitespace-nowrap">
                    {q.marks} marks
                  </span>
                </div>

                {q.type === "mcq" ? (
                  <div className="flex flex-col gap-1 mb-3">
                    {q.options.map((o) => {
                      const selected = a.options?.includes(o.id);
                      return (
                        <div
                          key={o.id}
                          className={`text-sm px-3 py-1.5 rounded-lg flex items-center gap-1.5 ${
                            o.isCorrect ? "bg-[#18181b]merald-500/15 text-emerald-200 border border-emerald-500/30" : selected ? "bg-red-500/10 text-red-400" : "text-white/70"
                          }`}
                        >
                          {selected && <span className="font-bold">●</span>}
                          {o.isCorrect && <Check className="h-3.5 w-3.5" />}
                          {o.value}
                        </div>
                      );
                    })}
                    <p className="text-xs text-gray-500 mt-1">Auto-scored: {a.marksAwarded ?? 0} / {q.marks}</p>
                  </div>
                ) : (
                  <div className="w-full bg-[#161b28] border border-white/10 rounded-lg px-5 py-4 mb-3 min-h-[120px]">
                    <p className="text-base text-gray-200 leading-relaxed whitespace-pre-wrap">{a.textAnswer || <span className="text-gray-600 italic">No answer provided</span>}</p>
                    {q.modelAnswer && <p className="text-xs text-gray-500 mt-3 italic">Model answer: {q.modelAnswer}</p>}
                  </div>
                )}

                <div className="grid grid-cols-[120px_1fr] gap-3 items-start">
                  <div className="space-y-1">
                    <label className="text-sm font-medium text-gray-300">Marks (/{q.marks})</label>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      max={q.marks}
                      value={marksByAnswer[a.id] ?? ""}
                      onChange={(e) => setMarksByAnswer((prev) => ({ ...prev, [a.id]: e.target.value }))}
                      className="w-full py-2.5 text-white transition-all text-sm rounded-none border-0 border-b border-white/20 bg-transparent px-0 transition-colors placeholder:text-zinc-500 focus:border-orange-500 focus:outline-none focus:ring-0"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm font-medium text-gray-300">Feedback (optional)</label>
                    <input
                      type="text"
                      value={feedbackByAnswer[a.id] ?? ""}
                      onChange={(e) => setFeedbackByAnswer((prev) => ({ ...prev, [a.id]: e.target.value }))}
                      placeholder="Feedback for this answer..."
                      className="w-full py-2.5 text-white placeholder:text-gray-500 transition-all text-sm rounded-none border-0 border-b border-white/20 bg-transparent px-0 transition-colors placeholder:text-zinc-500 focus:border-orange-500 focus:outline-none focus:ring-0"
                    />
                  </div>
                </div>
              </div>
            );
          })}

          <div className="pt-2 border-t border-white/5">
            <label className="text-sm font-semibold text-gray-300">Overall Feedback</label>
            <textarea
              value={overallFeedback}
              onChange={(e) => setOverallFeedback(e.target.value)}
              rows={3}
              placeholder="Overall comments for the student..."
              className="w-full mt-2 bg-[#18181b] border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-gray-500 focus:outline-none focus:ring-1 focus:ring-white/30 transition-all text-sm resize-none"
            />
          </div>

          <div className="flex justify-end">
            <Button size="lg" className="bg-[#18181b]merald-600 hover:bg-[#18181b]merald-700 text-white" onClick={handleSubmitGrade} disabled={saving}>
              {saving ? "Saving..." : "Submit Grade"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
