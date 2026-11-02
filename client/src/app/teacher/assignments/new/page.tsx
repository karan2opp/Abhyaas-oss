"use client";

import React, { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

import { createAssignmentService, createQuestionService, updateAssignmentService } from "@/app/teacher/assignments/assignment.service";
import { createExamService } from "@/app/teacher/exams/exam.service";
import { AssignmentDetailsForm, AssignmentDetails, EMPTY_ASSIGNMENT_DETAILS } from "./AssignmentDetailsForm";
import { QuestionBuilder, AiExamGeneratorForm, WorkspaceParts } from "../../exams/new/QuestionBuilder";
import { PyqFlow } from "../../exams/new/PyqFlow";
import { SourceFlow } from "../../exams/new/SourceFlow";
import { suggestTitleFromSections } from "../../exams/new/ExamDetailsForm";
import { WorkspaceShell, ModePicker, CreationMode } from "../../exams/new/workspace";
import QuestionReviewChat from "@/components/QuestionReviewChat";
import { useExamBuilderStore } from "@/store/useExamBuilderStore";

// Picking how to build the assignment creates a draft straight away; the details students see (title, dates,
// instructions) are filled in at the end, on the publish step, since none of them change the questions.
type Phase = "build" | "review" | "publish";

const PLACEHOLDER_ASSIGNMENT_TITLE = "Untitled assignment";

const primaryButton = "bg-orange-600 hover:bg-orange-700 text-white h-10 px-6 font-bold text-sm rounded-xl shadow-lg shadow-orange-950/40";
const ghostButton = "text-gray-400 hover:text-white h-10 px-4 text-sm font-semibold";

function NewAssignmentBuilderContent() {
  const router = useRouter();
  const { resetStore, isAiMode } = useExamBuilderStore();

  const [isMounted, setIsMounted] = useState(false);
  const [mode, setMode] = useState<CreationMode | null>(null);
  const [phase, setPhase] = useState<Phase>("build");
  const [isCreating, setIsCreating] = useState(false);

  const [assignmentId, setAssignmentId] = useState<string | null>(null);
  const [examId, setExamId] = useState<string | null>(null);
  const [details, setDetails] = useState<AssignmentDetails>(EMPTY_ASSIGNMENT_DETAILS);
  const [sections, setSections] = useState<any[]>([]);
  // The review chat is a full view of its own, opened from the question list, instead of a panel beside it.
  const [showReview, setShowReview] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setIsMounted(true);
    resetStore();
  }, [resetStore]);

  const questionCount = useMemo(() => sections.reduce((n, s) => n + (s.questions?.length || 0), 0), [sections]);
  const totalMarks = useMemo(
    () => sections.reduce((sum, s) => sum + (s.questions || []).reduce((m: number, q: any) => m + (Number(q.marks) || 0), 0), 0),
    [sections]
  );

  // The first pick creates the draft assignment and the working exam its questions are built in; picking again later
  // (after going back) reuses them.
  const handlePickMode = async (picked: CreationMode) => {
    if (assignmentId && examId) {
      setMode(picked);
      return;
    }
    setIsCreating(true);
    try {
      const data = await createAssignmentService({ title: PLACEHOLDER_ASSIGNMENT_TITLE, totalMarks: 0 } as any);
      const newAssignment = data.data || data;
      setAssignmentId(newAssignment.id || newAssignment._id);

      const examData = await createExamService({ title: PLACEHOLDER_ASSIGNMENT_TITLE, type: "ON_DEMAND", duration: 60, instructions: [], totalMarks: 0 });
      const newExam = examData.data || examData;
      setExamId(newExam.id || newExam._id);
      setMode(picked);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || err.message || "Failed to start a new assignment");
    } finally {
      setIsCreating(false);
    }
  };

  // Suggest a title from the subject so the teacher rarely has to type one.
  const goToPublish = () => {
    setDetails((prev) => (prev.title.trim() ? prev : { ...prev, title: suggestTitleFromSections(sections).replace(/Exam$/, "Assignment") }));
    setPhase("publish");
  };

  // Saves the details, then copies the built questions into the assignment.
  const handleSaveAssignment = async () => {
    if (!assignmentId) return;
    const title = details.title.trim() || suggestTitleFromSections(sections).replace(/Exam$/, "Assignment") || PLACEHOLDER_ASSIGNMENT_TITLE;
    if (phase === "publish" && (!details.title.trim() || details.title.trim() === PLACEHOLDER_ASSIGNMENT_TITLE)) {
      toast.error("Please enter an assignment title");
      return;
    }
    if (details.startDate && details.dueDate && new Date(details.dueDate) <= new Date(details.startDate)) {
      toast.error("The due date must be after the start date");
      return;
    }
    setIsSaving(true);
    try {
      await updateAssignmentService(assignmentId, {
        title,
        instructions: details.instructions.filter((i) => i.trim() !== "").join("\n"),
        startDate: details.startDate ? new Date(details.startDate).toISOString() : null,
        dueDate: details.dueDate ? new Date(details.dueDate).toISOString() : null,
      });

      // Sync generated questions from sections tree to assignment questions
      const MCQ_LETTERS = ["A", "B", "C", "D"];
      let importedCount = 0;
      for (const section of sections) {
        const qList = section.questions || [];
        for (const q of qList) {
          const type = q.type === "mcq" || q.questionType === "mcq" || q.options?.length ? "mcq" : "descriptive";
          const rawOpts = q.options || [];
          const options = type === "mcq" && rawOpts.length ? rawOpts.map((opt: any, idx: number) => ({
            value: typeof opt === "string" ? opt : opt.text || opt.value || "",
            isCorrect: opt.isCorrect ?? (MCQ_LETTERS[idx] === q.correct_option || idx === 0),
          })) : undefined;

          await createQuestionService({
            assignmentId,
            type,
            description: q.question_text || q.description || q.stem || "Question",
            marks: Number(q.marks) || 5,
            modelAnswer: q.modelAnswer || q.model_answer || undefined,
            options,
          });
          importedCount++;
        }
      }

      toast.success(importedCount > 0 ? `Assignment published with ${importedCount} question(s)!` : "Assignment saved!");
      resetStore();
      router.push(`/teacher/assignments`);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || err.message || "Failed to save assignment");
    } finally {
      setIsSaving(false);
    }
  };

  if (!isMounted) return null;

  const modePicker = (
    <WorkspaceShell
      left={
        <div className="mx-auto w-full max-w-2xl space-y-4">
          <h2 className="text-lg font-bold text-white">Create a new assignment</h2>
          <p className="text-xs text-gray-400">Pick how to build it. Title, dates and instructions come at the end, when you publish.</p>
          {isCreating ? (
            <div className="flex items-center gap-2 py-10 text-sm text-gray-400">
              <Loader2 className="h-4 w-4 animate-spin" /> Starting your assignment...
            </div>
          ) : (
            <ModePicker selected={null} onSelect={(m) => void handlePickMode(m)} />
          )}
        </div>
      }
    />
  );

  const buildShell = (parts: WorkspaceParts) => <WorkspaceShell left={parts.left} right={parts.right} footer={parts.footer} fill={parts.fill} />;
  // "Back" from the first build step returns to the mode picker; the draft is kept and reused.
  const backToModes = () => setMode(null);
  const goToReview = () => setPhase("review");

  let content: React.ReactNode;
  if (phase === "build" && (!examId || !mode)) {
    content = modePicker;
  } else if (phase === "build" && examId && mode === "ai") {
    content = <AiExamGeneratorForm examId={examId} saveStatus={null} onBack={backToModes} onSuccess={goToReview} renderShell={buildShell} />;
  } else if (phase === "build" && examId && mode === "pyq") {
    content = <PyqFlow examId={examId} onBack={backToModes} onSuccess={goToReview} renderShell={buildShell} />;
  } else if (phase === "build" && examId && mode === "source") {
    content = <SourceFlow examId={examId} onBack={backToModes} onSuccess={goToReview} renderShell={buildShell} onStepChange={() => {}} />;
  } else if (phase === "review" && examId) {
    content = (
      <WorkspaceShell
        left={
          showReview ? (
            <QuestionReviewChat examId={examId} onSectionsChange={setSections} />
          ) : (
            <div className="space-y-6">
              {questionCount > 0 && !isAiMode && (
                <div className="flex justify-end">
                  <Button onClick={() => setShowReview(true)} className="h-10 gap-2 rounded-full bg-orange-600 px-5 text-sm font-semibold text-white hover:bg-orange-700">
                    <Sparkles className="h-4 w-4" /> Review with AI
                  </Button>
                </div>
              )}
              <QuestionBuilder examId={examId} sectionsState={{ sections, setSections }} showReviewAgent={false} />
            </div>
          )
        }
        fill={showReview}
        footer={
          showReview ? (
            <Button variant="ghost" onClick={() => setShowReview(false)} className={ghostButton}>
              <ArrowLeft className="h-4 w-4 mr-1.5" /> Back to questions
            </Button>
          ) : (
            <>
              <Button variant="ghost" onClick={handleSaveAssignment} disabled={isSaving} className={ghostButton}>
                Save as Draft & Exit
              </Button>
              <Button onClick={goToPublish} className={primaryButton}>
                Next: Publish Settings <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </>
          )
        }
      />
    );
  } else {
    content = (
      <WorkspaceShell
        left={
          <div className="space-y-10">
            <p className="text-xs text-gray-400">
              {sections.length} section{sections.length === 1 ? "" : "s"} · {questionCount} question{questionCount === 1 ? "" : "s"} · {totalMarks} marks
            </p>
            <AssignmentDetailsForm values={details} onChange={(patch) => setDetails((prev) => ({ ...prev, ...patch }))} />
          </div>
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setPhase("review")} className={ghostButton}>
              <ArrowLeft className="h-4 w-4 mr-1.5" /> Previous
            </Button>
            <Button onClick={handleSaveAssignment} disabled={isSaving} className="bg-green-600 hover:bg-green-700 text-white h-10 px-6 font-bold text-sm rounded-xl">
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Publish Assignment"}
            </Button>
          </>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-3 lg:h-full lg:min-h-0">
      <div className="flex items-center gap-3 shrink-0">
        <button
          onClick={() => router.push(`/teacher/assignments`)}
          aria-label="Back to assignments"
          className="flex items-center justify-center p-2 rounded-lg bg-[#18181b] border border-white/10 hover:bg-white/10 hover:text-white transition-colors text-gray-400"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 lg:min-h-0">{content}</div>
    </div>
  );
}

export default function NewAssignmentBuilder() {
  return (
    <Suspense fallback={<div className="p-4 sm:p-6 md:p-10 text-white text-center">Loading...</div>}>
      <NewAssignmentBuilderContent />
    </Suspense>
  );
}
