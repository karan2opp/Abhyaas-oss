"use client";

import React, { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Check, CheckCircle2, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  getAssignmentByIdService,
  getQuestionsService,
  startAssignmentService,
  saveAnswerService,
  submitAssignmentService,
  getMySubmissionService,
} from "../assignment.service";
import { formatDateTime } from "@/lib/date";

interface Assignment {
  id: string;
  title: string;
  instructions: string | null;
  totalMarks: number;
  startDate: string | null;
  dueDate: string | null;
}

interface Option {
  id: string;
  value: string;
}

interface Question {
  id: string;
  type: "mcq" | "descriptive";
  description: string;
  marks: number;
  options: Option[];
}

interface Answer {
  id: string;
  questionId: string;
  options: string[] | null;
  textAnswer: string | null;
  marksAwarded: number | null;
  feedback: string | null;
}

interface Submission {
  id: string;
  status: "in_progress" | "submitted" | "graded" | "evaluating";
  submittedAt: string | null;
  isLate: boolean;
  totalMarksAwarded: number | null;
  overallFeedback: string | null;
  answers?: Answer[];
}

export default function StudentAssignmentPage() {
  const params = useParams();
  const router = useRouter();
  const assignmentId = params.id as string;

  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [selectedOptions, setSelectedOptions] = useState<Record<string, string>>({});
  const [textAnswers, setTextAnswers] = useState<Record<string, string>>({});
  const [editingSubmission, setEditingSubmission] = useState(false);

  const loadAnswersIntoForm = (sub: Submission) => {
    const opts: Record<string, string> = {};
    const texts: Record<string, string> = {};
    (sub.answers || []).forEach((a) => {
      if (a.options && a.options[0]) opts[a.questionId] = a.options[0];
      if (a.textAnswer) texts[a.questionId] = a.textAnswer;
    });
    setSelectedOptions(opts);
    setTextAnswers(texts);
  };

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [aRes, qRes, startRes] = await Promise.all([
          getAssignmentByIdService(assignmentId),
          getQuestionsService(assignmentId),
          startAssignmentService(assignmentId),
        ]);
        setAssignment(aRes.data);
        setQuestions(qRes.data || []);
        const sub: Submission = startRes.data;

        if (sub.status !== "in_progress") {
          const fullSub = await getMySubmissionService(assignmentId);
          setSubmission(fullSub.data);
          loadAnswersIntoForm(fullSub.data);
        } else {
          setSubmission(sub);
          loadAnswersIntoForm(sub);
        }
      } catch (err: any) {
        toast.error(err.response?.data?.message || "Failed to load assignment");
      } finally {
        setLoading(false);
      }
    })();
  }, [assignmentId]);

  const canEditSubmission =
    submission?.status === "submitted" &&
    (!assignment?.dueDate || new Date() <= new Date(assignment.dueDate));

  const handleSelectOption = async (question: Question, optionId: string) => {
    if (!submission) return;
    setSelectedOptions((prev) => ({ ...prev, [question.id]: optionId }));
    try {
      await saveAnswerService({ submissionId: submission.id, questionId: question.id, options: [optionId] });
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Failed to save answer");
    }
  };

  const handleTextBlur = async (question: Question) => {
    if (!submission) return;
    const value = textAnswers[question.id];
    if (!value || !value.trim()) return;
    try {
      await saveAnswerService({ submissionId: submission.id, questionId: question.id, textAnswer: value });
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Failed to save answer");
    }
  };

  const handleSubmitAssignment = async () => {
    if (!submission) return;
    const isResubmit = submission.status === "submitted";
    if (!confirm(isResubmit ? "Save your changes to this submission?" : "Submit this assignment? You can still edit it before the due date.")) return;
    setSubmitting(true);
    try {
      await submitAssignmentService(submission.id);
      toast.success(isResubmit ? "Submission updated" : "Assignment submitted");
      const fullSub = await getMySubmissionService(assignmentId);
      setSubmission(fullSub.data);
      setEditingSubmission(false);
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Failed to submit assignment");
    } finally {
      setSubmitting(false);
    }
  };

  const handleEditSubmission = () => {
    if (!submission) return;
    loadAnswersIntoForm(submission);
    setEditingSubmission(true);
  };

  const autoResize = React.useCallback((el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  if (loading) return <div className="p-4 sm:p-6 md:p-10 text-white text-center">Loading assignment...</div>;
  if (!assignment) return <div className="p-4 sm:p-6 md:p-10 text-white text-center">Assignment not found</div>;

  const isReadOnly = submission?.status !== "in_progress" && !(submission?.status === "submitted" && editingSubmission);

  return (
    <div className="p-4 sm:p-6 md:p-10 h-full overflow-y-auto custom-scrollbar w-full">
      <button
        onClick={() => router.back()}
        className="flex items-center gap-2 text-gray-400 hover:text-white text-sm mb-6 transition-colors"
      >
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      <div className="w-full bg-[#0b0e14] border border-white/10 rounded-2xl p-5 sm:p-8">
        <div className="pb-6 mb-6 border-b border-white/10 text-center">
          <h2 className="text-2xl md:text-3xl font-bold text-white tracking-tight">{assignment.title}</h2>
          {assignment.instructions && <p className="text-gray-400 text-sm mt-2">{assignment.instructions}</p>}
        </div>

        {(submission?.status === "submitted" || submission?.status === "graded" || submission?.status === "evaluating") && !editingSubmission && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-8">
            <div className="bg-[#161b28] border border-white/10 rounded-lg p-4">
              <p className="text-[11px] text-gray-400 font-semibold uppercase tracking-wide mb-1.5">Submitted On</p>
              <p className="text-sm font-semibold text-white">{submission.submittedAt ? formatDateTime(submission.submittedAt) : "—"}</p>
              {submission.isLate && <p className="text-xs text-amber-400 mt-0.5">Late submission</p>}
            </div>
            {submission.status === "graded" && (
              <div className="bg-[#161b28] border border-white/10 rounded-lg p-4">
                <p className="text-[11px] text-gray-400 font-semibold uppercase tracking-wide mb-1.5">Your Marks</p>
                <p className="text-sm font-semibold text-emerald-400">{submission.totalMarksAwarded}/{assignment.totalMarks}</p>
              </div>
            )}
          </div>
        )}

        <div className="text-center mb-8">
          {submission && submission.status === "graded" && !editingSubmission && submission.overallFeedback && (
            <p className="text-gray-300 text-sm">{submission.overallFeedback}</p>
          )}

          {submission && submission.status === "submitted" && !editingSubmission && (
            <div className="mt-4 p-4 rounded-lg bg-[#18181b]merald-600/10 border border-emerald-500/20 flex items-center justify-between gap-3 text-left">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0" />
                <div>
                  <p className="text-emerald-400 font-semibold text-sm">
                    Submitted
                    {submission.isLate && " (Late)"}
                  </p>
                </div>
              </div>
              {canEditSubmission && (
                <Button variant="ghost" className="text-orange-400 hover:text-orange-300 shrink-0" onClick={handleEditSubmission}>
                  Edit Submission
                </Button>
              )}
            </div>
          )}

          {submission && submission.status === "evaluating" && (
            <div className="mt-4 p-4 rounded-lg bg-orange-600/10 border border-orange-500/30 flex items-center gap-3 text-left animate-pulse">
              <Clock className="h-5 w-5 text-orange-400 shrink-0" />
              <div>
                <p className="text-orange-400 font-semibold text-sm">
                  Evaluating Submission
                </p>
                <p className="text-gray-400 text-xs mt-0.5">
                  The AI is currently evaluating your descriptive answers in the background. Refresh in a few moments.
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-6">
          {questions.map((q, idx) => {
            const answer = submission?.answers?.find((a) => a.questionId === q.id);
            return (
              <div key={q.id}>
                <div className="flex items-start justify-between gap-4 mb-3">
                  <p className="text-white text-base font-medium leading-relaxed">
                    <span className="font-bold">Q{idx + 1}:</span> {q.description}
                  </p>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-orange-500/10 text-orange-400 border border-orange-500/30 shrink-0 whitespace-nowrap">
                      {q.marks} marks
                    </span>
                  </div>
                </div>

                {q.type === "mcq" ? (
                  <div className="flex flex-col gap-2">
                    {q.options.map((o) => {
                      const isSelected = isReadOnly ? answer?.options?.includes(o.id) : selectedOptions[q.id] === o.id;
                      return (
                        <button
                          key={o.id}
                          type="button"
                          disabled={isReadOnly}
                          onClick={() => handleSelectOption(q, o.id)}
                          className={`flex items-center gap-3 px-4 py-2.5 rounded-lg border text-left text-sm transition-all ${
                            isSelected ? "bg-orange-500/20 border-orange-500/50 text-sky-200 font-medium" : "bg-[#0f0f11] border-white/10 text-white/80 hover:bg-white/5"
                          } ${isReadOnly ? "cursor-default" : "cursor-pointer"}`}
                        >
                          <span className={`h-4 w-4 rounded-full border flex items-center justify-center shrink-0 ${isSelected ? "border-blue-400 bg-orange-600" : "border-gray-500"}`}>
                            {isSelected && <Check className="h-3 w-3 text-white" />}
                          </span>
                          {o.value}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <textarea
                    ref={autoResize}
                    disabled={isReadOnly}
                    value={isReadOnly ? (answer?.textAnswer || "") : (textAnswers[q.id] || "")}
                    onChange={(e) => {
                      setTextAnswers((prev) => ({ ...prev, [q.id]: e.target.value }));
                      autoResize(e.target);
                    }}
                    onBlur={() => handleTextBlur(q)}
                    rows={8}
                    placeholder="Write your answer here..."
                    className="w-full bg-[#0f0f11] border border-white/10 rounded-lg px-5 py-4 text-white placeholder:text-gray-500 focus:outline-none focus:ring-1 focus:ring-white/30 transition-all text-base leading-relaxed resize-none overflow-hidden min-h-[260px] disabled:opacity-70"
                  />
                )}

                 
                {isReadOnly && answer?.marksAwarded !== null && answer?.marksAwarded !== undefined && (
                  <p className="text-xs text-emerald-400 font-semibold mt-2">Marks: {answer.marksAwarded}/{q.marks}</p>
                )}
                {isReadOnly && answer?.feedback && <p className="text-xs text-gray-400 italic mt-1">{answer.feedback}</p>}
              </div>
            );
          })}
        </div>

        {!isReadOnly && (
          <div className="flex justify-end gap-2 mt-8">
            {editingSubmission && (
              <Button
                variant="ghost"
                className="text-gray-300 hover:text-white"
                onClick={() => {
                  setEditingSubmission(false);
                  if (submission) loadAnswersIntoForm(submission);
                }}
              >
                Cancel
              </Button>
            )}
            <Button className="bg-[#18181b]merald-600 hover:bg-[#18181b]merald-700 text-white" onClick={handleSubmitAssignment} disabled={submitting}>
              {submitting ? "Saving..." : editingSubmission ? "Save Changes" : "Submit Assignment"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
