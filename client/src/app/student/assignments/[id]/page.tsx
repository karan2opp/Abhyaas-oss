"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, CalendarX2, CheckCircle2, Clock, Lock } from "lucide-react";
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
import { SUBMISSION_CLOSED_MESSAGE, TestTakingScreen, type TestQuestion } from "@/components/TestTakingScreen";
import { OptionValue, QuestionText } from "@/components/QuestionContentBlocks";

interface Assignment {
  id: string;
  title: string;
  instructions: string | null;
  totalMarks: number;
  startDate: string | null;
  dueDate: string | null;
}

interface Question {
  id: string;
  type: "mcq" | "descriptive";
  description: string;
  marks: number;
  images?: { url: string }[] | null;
  contentBlocks?: any[] | null;
  // The exam section the question was built in; null for questions written by hand.
  sectionTitle?: string | null;
  options: { id: string; value: string; isCode?: boolean }[];
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

/**
 * A student's assignment. Answering happens on the same screen as an exam, without a timer: the due date is shown
 * instead, and after it nothing can be submitted. Once submitted, the student sees their answers (and marks when graded)
 * and can still edit them until the due date.
 */
export default function StudentAssignmentPage() {
  const params = useParams();
  const router = useRouter();
  const assignmentId = params.id as string;

  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [loading, setLoading] = useState(true);
  // Why it can't be opened yet (not unlocked, or the previous assignment of the series isn't done).
  const [lockedMessage, setLockedMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [aRes, qRes, mineRes] = await Promise.all([getAssignmentByIdService(assignmentId), getQuestionsService(assignmentId), getMySubmissionService(assignmentId)]);
      const a: Assignment = aRes.data;
      setAssignment(a);
      setQuestions(qRes.data || []);

      let mine: Submission | null = mineRes.data ?? null;
      const pastDue = !!a.dueDate && Date.now() > new Date(a.dueDate).getTime();
      // Not started yet and still open: start it now (this also checks it is unlocked).
      if (!mine && !pastDue) {
        try {
          const started = await startAssignmentService(assignmentId);
          mine = { ...started.data, answers: [] };
        } catch (err: any) {
          setLockedMessage(err.response?.data?.message || "This assignment is not open yet.");
        }
      }
      setSubmission(mine);
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Failed to load assignment");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [assignmentId]);

  // Sections are shown as tabs, as in an exam, when every question belongs to one.
  const useSections = questions.length > 0 && questions.every((q) => !!q.sectionTitle);
  const sectionTitles = useMemo(() => (useSections ? [...new Set(questions.map((q) => q.sectionTitle as string))] : []), [questions, useSections]);
  const testQuestions = useMemo<TestQuestion[]>(
    () =>
      questions.map((q, i) => ({
        id: q.id,
        globalIndex: i,
        sectionTitle: useSections ? (q.sectionTitle as string) : "",
        description: q.description,
        marks: q.marks,
        type: q.type,
        options: q.options || [],
        images: q.images || [],
        contentBlocks: q.contentBlocks || [],
      })),
    [questions, useSections]
  );

  if (loading) return <div className="flex items-center justify-center h-full bg-[#050505] text-white">Loading assignment...</div>;
  if (!assignment) return <CenteredMessage icon={<CalendarX2 className="h-8 w-8 text-gray-500" />} title="Assignment not found" onBack={() => router.back()} />;

  const pastDue = !!assignment.dueDate && Date.now() > new Date(assignment.dueDate).getTime();
  const isSubmitted = !!submission && submission.status !== "in_progress";

  // ── Can't be opened yet ──
  if (lockedMessage) {
    return <CenteredMessage icon={<Lock className="h-8 w-8 text-amber-400" />} title={assignment.title} message={lockedMessage} onBack={() => router.back()} />;
  }

  // ── Due date passed without a submission ──
  if (!isSubmitted && pastDue) {
    return (
      <CenteredMessage
        icon={<CalendarX2 className="h-8 w-8 text-red-400" />}
        title={assignment.title}
        message={SUBMISSION_CLOSED_MESSAGE}
        detail={assignment.dueDate ? `It was due on ${formatDateTime(assignment.dueDate)}.` : undefined}
        onBack={() => router.back()}
      />
    );
  }

  // ── Answering (first time, or editing a submission before the due date) ──
  if (submission && (!isSubmitted || editing)) {
    if (testQuestions.length === 0) {
      return <CenteredMessage icon={<CalendarX2 className="h-8 w-8 text-gray-500" />} title={assignment.title} message="This assignment has no questions yet." onBack={() => router.back()} />;
    }
    const answers: Record<string, string[]> = {};
    const textAnswers: Record<string, string> = {};
    for (const a of submission.answers ?? []) {
      if (a.options && a.options.length > 0) answers[a.questionId] = a.options;
      if (a.textAnswer) textAnswers[a.questionId] = a.textAnswer;
    }
    const totalMarks = testQuestions.reduce((sum, q) => sum + (q.marks || 0), 0);
    return (
      <TestTakingScreen
        kind="assignment"
        title={assignment.title}
        storageId={`assignment:${submission.id}`}
        questions={testQuestions}
        sectionTitles={sectionTitles}
        initialAnswers={answers}
        initialTextAnswers={textAnswers}
        clock={{ kind: "due", dueDate: assignment.dueDate }}
        instructionStats={[
          { label: "Due", value: assignment.dueDate ? formatDateTime(assignment.dueDate) : "No due date" },
          { label: "Time limit", value: "None" },
          { label: "Questions", value: String(testQuestions.length) },
          { label: "Marks", value: String(totalMarks), accent: true },
        ]}
        teacherInstructions={assignment.instructions}
        skipInstructions={editing}
        saveAnswer={async (questionId, answer) => {
          await saveAnswerService({ submissionId: submission.id, questionId, ...answer });
        }}
        submit={async () => {
          await submitAssignmentService(submission.id);
        }}
        onSubmitted={() => {
          setEditing(false);
          void load();
        }}
      />
    );
  }

  // ── Submitted: the answers, and marks once graded ──
  const canEdit = submission?.status === "submitted" && !pastDue;
  return (
    <div className="h-full overflow-y-auto custom-scrollbar bg-[#050505]">
      <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-10">
        <button onClick={() => router.back()} className="mb-6 flex items-center gap-2 text-sm text-gray-400 transition-colors hover:text-white">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>

        <p className="text-[11px] font-semibold uppercase tracking-widest text-orange-400">Assignment</p>
        <h1 className="mt-1.5 break-words text-2xl font-bold tracking-tight text-white sm:text-3xl">{assignment.title}</h1>

        <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 border-y border-white/10 py-5 sm:grid-cols-3">
          <div>
            <dt className="text-xs text-zinc-500">Submitted</dt>
            <dd className="mt-0.5 text-sm font-semibold text-white">{submission?.submittedAt ? formatDateTime(submission.submittedAt) : "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-500">Due</dt>
            <dd className="mt-0.5 text-sm font-semibold text-white">{assignment.dueDate ? formatDateTime(assignment.dueDate) : "No due date"}</dd>
          </div>
          {submission?.status === "graded" && (
            <div>
              <dt className="text-xs text-zinc-500">Your marks</dt>
              <dd className="mt-0.5 text-sm font-semibold text-emerald-400">
                {submission.totalMarksAwarded}/{assignment.totalMarks}
              </dd>
            </div>
          )}
        </dl>

        {submission?.status === "evaluating" && (
          <p className="mt-5 flex items-start gap-2 text-sm text-orange-300">
            <Clock className="mt-0.5 h-4 w-4 shrink-0" /> Your written answers are being graded. Check back in a few moments.
          </p>
        )}
        {submission?.status === "submitted" && (
          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-center gap-2 text-sm font-semibold text-emerald-400">
              <CheckCircle2 className="h-4 w-4 shrink-0" /> Submitted
            </p>
            {canEdit && (
              <Button onClick={() => setEditing(true)} className="bg-orange-600 font-semibold text-white hover:bg-orange-700">
                Edit submission
              </Button>
            )}
          </div>
        )}
        {submission?.status === "graded" && submission.overallFeedback && <p className="mt-5 text-sm text-gray-300">{submission.overallFeedback}</p>}

        <ol className="mt-8 space-y-6">
          {questions.map((q, idx) => {
            const answer = submission?.answers?.find((a) => a.questionId === q.id);
            return (
              <li key={q.id} className="border-b border-white/10 pb-6">
                <div className="mb-3 flex items-start justify-between gap-4">
                  <QuestionText label={`Q${idx + 1}.`} description={q.description} blocks={q.contentBlocks} className="text-base font-medium leading-relaxed text-white" />
                  <span className="shrink-0 whitespace-nowrap text-xs font-semibold text-orange-400">{q.marks} marks</span>
                </div>
                {q.type === "mcq" ? (
                  <ul className="space-y-1.5">
                    {q.options.map((o) => {
                      const chosen = answer?.options?.includes(o.id);
                      return (
                        <li key={o.id} className={chosen ? "text-sm font-semibold text-orange-200" : "text-sm text-gray-400"}>
                          {chosen ? "● " : "○ "}
                          <OptionValue value={o.value} isCode={o.isCode} size="compact" />
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-300">{answer?.textAnswer || <span className="italic text-gray-500">No answer</span>}</p>
                )}
                {answer?.marksAwarded !== null && answer?.marksAwarded !== undefined && submission?.status === "graded" && (
                  <p className="mt-2 text-xs font-semibold text-emerald-400">
                    Marks: {answer.marksAwarded}/{q.marks}
                  </p>
                )}
                {answer?.feedback && <p className="mt-1 text-xs italic text-gray-400">{answer.feedback}</p>}
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

function CenteredMessage({ icon, title, message, detail, onBack }: { icon: React.ReactNode; title: string; message?: string; detail?: string; onBack: () => void }) {
  return (
    <div className="flex h-full items-center justify-center bg-[#050505] px-4">
      <div className="w-full max-w-md space-y-4 text-center">
        <div className="flex justify-center">{icon}</div>
        <h1 className="break-words text-xl font-bold text-white">{title}</h1>
        {message && <p className="text-sm text-gray-300">{message}</p>}
        {detail && <p className="text-xs text-gray-500">{detail}</p>}
        <Button variant="ghost" onClick={onBack} className="text-gray-300 hover:bg-white/5 hover:text-white">
          <ArrowLeft className="mr-1.5 h-4 w-4" /> Back
        </Button>
      </div>
    </div>
  );
}
