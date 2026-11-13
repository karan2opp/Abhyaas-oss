"use client";

import React, { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Loader2, ShieldAlert, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { useParams, useRouter } from "next/navigation";

import { getExamByIdService, updateExamService } from "../exam.service";
import { QuestionBuilder, AiExamGeneratorForm, WorkspaceParts } from "../new/QuestionBuilder";
import { PyqFlow } from "../new/PyqFlow";
import { SourceFlow } from "../new/SourceFlow";
import {
  ExamDetailsForm,
  ExamDetails,
  EMPTY_EXAM_DETAILS,
  PLACEHOLDER_EXAM_TITLE,
  suggestTitleFromSections,
  publishProblem,
  examDetailsPayload,
} from "../new/ExamDetailsForm";
import { WorkspaceShell, CreationMode } from "../new/workspace";
import QuestionReviewChat from "@/components/QuestionReviewChat";
import { useExamBuilderStore } from "@/store/useExamBuilderStore";
import { DateTimeInput } from "@/components/DateTimeInput";

// The details students see (title, timing, instructions) live on the publish step, same as when creating an exam.
type Phase = "questions" | "publish";

const primaryButton = "bg-purple-600 hover:bg-purple-700 text-white h-10 px-6 font-bold text-sm rounded-xl shadow-lg shadow-purple-950/40";
const ghostButton = "text-gray-400 hover:text-white h-10 px-4 text-sm font-semibold";

export default function EditExamBuilder() {
  const params = useParams();
  const router = useRouter();
  const examId = params.examId as string;
  const { resetStore, isAiMode } = useExamBuilderStore();

  const [isMounted, setIsMounted] = useState(false);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [accessDenied, setAccessDenied] = useState(false);
  const [phase, setPhase] = useState<Phase>("questions");
  // Set when the teacher picks a way to add questions to an exam that has none yet.
  const [buildMode, setBuildMode] = useState<CreationMode | null>(null);
  // Changing this reloads the question list after one of those ways has added questions.
  const [builderKey, setBuilderKey] = useState(0);

  // The way of adding questions the teacher picked is only held in the page, so a reload would drop them back on the
  // picker. It is remembered per exam in this browser until they finish or go back.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(`edit-build-mode:${examId}`);
      if (saved === "ai" || saved === "pyq" || saved === "source") setBuildMode(saved);
    } catch {
      // Not remembering is harmless.
    }
  }, [examId]);

  const [details, setDetails] = useState<ExamDetails>(EMPTY_EXAM_DETAILS);
  const [isPublished, setIsPublished] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [publishTime, setPublishTime] = useState("");
  const [sections, setSections] = useState<any[]>([]);
  // The review chat is a full view of its own, opened from the question list, instead of a panel beside it.
  const [showReview, setShowReview] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setIsMounted(true);
    // A leftover AI-mode flag from a previous session would open the wrong
    // view inside the question builder.
    resetStore();
  }, [resetStore]);

  useEffect(() => {
    if (!examId) return;
    getExamByIdService(examId)
      .then((res) => {
        const data = res.data || res;
        const toDatetimeLocal = (value?: string) => {
          if (!value) return "";
          const d = new Date(value);
          return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
        };
        setDetails({
          // A draft that never got a real title shows an empty field (filled in from the subject on the publish step).
          title: data.title && data.title !== PLACEHOLDER_EXAM_TITLE ? data.title : "",
          type: data.type === "ON_DEMAND" ? "ON_DEMAND" : "SCHEDULED",
          duration: data.duration?.toString() || "60",
          startTime: toDatetimeLocal(data.startTime),
          endTime: toDatetimeLocal(data.endTime),
          instructions: data.instructions?.length > 0 ? data.instructions : [""],
          requireFeedback: !!data.requireFeedback,
        });
        setIsPublished(data.status === "PUBLISHED");
        if (data.joinCode) setJoinCode(data.joinCode);
        setPublishTime(toDatetimeLocal(data.publishTime));
      })
      .catch((err: any) => {
        if (err?.response?.status === 403) {
          setAccessDenied(true);
        } else {
          toast.error("Failed to load exam details");
        }
      })
      .finally(() => setLoadingInitial(false));
  }, [examId]);

  const questionCount = useMemo(() => sections.reduce((n, s) => n + (s.questions?.length || 0), 0), [sections]);
  const totalMarks = useMemo(
    () => sections.reduce((sum, s) => sum + (s.questions || []).reduce((m: number, q: any) => m + (Number(q.marks) || 0), 0), 0),
    [sections]
  );

  // Suggest a title from the subject so the teacher rarely has to type one.
  const goToPublish = () => {
    setDetails((prev) => (prev.title.trim() ? prev : { ...prev, title: suggestTitleFromSections(sections) }));
    setPhase("publish");
  };

  // "Save" keeps the exam's current status; a live (published) exam must stay complete, so it's checked like a publish.
  const handleSaveExam = async (status?: "PUBLISHED") => {
    const goingLive = status === "PUBLISHED" || isPublished;
    if (goingLive) {
      const problem = publishProblem(details);
      if (problem) {
        toast.error(problem);
        return;
      }
      if (publishTime && details.startTime && new Date(publishTime) >= new Date(details.startTime)) {
        toast.error("Publish date and time must be before the exam's start time");
        return;
      }
    }
    setIsSaving(true);
    try {
      await updateExamService(examId, {
        ...examDetailsPayload(details),
        publishTime: publishTime ? new Date(publishTime).toISOString() : null,
        ...(status ? { status } : {}),
      });
      toast.success(status ? "Exam published successfully!" : "Changes saved");
      resetStore();
      router.push(`/teacher/exams`);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || err.message || "Failed to save exam");
    } finally {
      setIsSaving(false);
    }
  };

  if (loadingInitial || !isMounted) return <div className="p-4 sm:p-6 md:p-10 text-white text-center">Loading exam...</div>;

  if (accessDenied) {
    return (
      <Dialog open onOpenChange={(open) => !open && router.push(`/teacher/exams`)}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-400">
              <ShieldAlert className="h-5 w-5" /> No permission to edit
            </DialogTitle>
            <DialogDescription>
              This exam was created by another teacher. You can&apos;t view or edit its questions.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => router.push(`/teacher/exams`)} className={primaryButton}>
              Back to exams
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  const phases: { id: Phase; label: string }[] = [
    { id: "questions", label: "Questions" },
    { id: "publish", label: "Publish" },
  ];
  const currentIndex = phases.findIndex((p) => p.id === phase);

  const header = (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-bold text-white">Editing exam</div>
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        {phases.map((p, i) => (
          <li key={p.id} className="flex items-center gap-2">
            <button
              onClick={() => (p.id === "publish" ? goToPublish() : setPhase(p.id))}
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                i === currentIndex
                  ? "border-orange-500/60 bg-orange-500/10 text-orange-300"
                  : i < currentIndex
                  ? "border-white/15 text-gray-300 hover:text-white"
                  : "border-white/10 text-gray-500 hover:text-white"
              }`}
            >
              {p.label}
            </button>
            {i < phases.length - 1 && <span className="text-gray-600">→</span>}
          </li>
        ))}
      </ol>
    </div>
  );

  const buildShell = (parts: WorkspaceParts) => <WorkspaceShell header={header} left={parts.left} right={parts.right} footer={parts.footer} fill={parts.fill} bare={parts.bare} />;
  const rememberBuildMode = (mode: CreationMode | null) => {
    setBuildMode(mode);
    try {
      if (mode) localStorage.setItem(`edit-build-mode:${examId}`, mode);
      else localStorage.removeItem(`edit-build-mode:${examId}`);
    } catch {
      // Not remembering is harmless.
    }
  };
  const stopBuilding = () => rememberBuildMode(null);
  const finishBuilding = () => {
    rememberBuildMode(null);
    setBuilderKey((k) => k + 1);
  };

  let content: React.ReactNode;
  if (phase === "questions" && buildMode === "ai") {
    content = <AiExamGeneratorForm examId={examId} saveStatus={null} onBack={stopBuilding} onSuccess={finishBuilding} renderShell={buildShell} />;
  } else if (phase === "questions" && buildMode === "pyq") {
    content = <PyqFlow examId={examId} onBack={stopBuilding} onSuccess={finishBuilding} renderShell={buildShell} />;
  } else if (phase === "questions" && buildMode === "source") {
    content = <SourceFlow examId={examId} onBack={stopBuilding} onSuccess={finishBuilding} renderShell={buildShell} onStepChange={() => {}} />;
  } else if (phase === "questions") {
    content = (
      <WorkspaceShell
        header={header}
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
              <QuestionBuilder key={builderKey} examId={examId} sectionsState={{ sections, setSections }} showReviewAgent={false} onPickMode={rememberBuildMode} />
            </div>
          )
        }
        fill={showReview}
        bare
        footer={
          showReview ? (
            <Button variant="ghost" onClick={() => setShowReview(false)} className={ghostButton}>
              <ArrowLeft className="h-4 w-4 mr-1.5" /> Back to questions
            </Button>
          ) : (
            <>
              <span />
              <Button onClick={goToPublish} className={`${primaryButton} whitespace-nowrap px-4 sm:px-6`}>
                <span className="sm:hidden">Publish Settings</span><span className="hidden sm:inline">Next: Publish Settings</span> <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </>
          )
        }
      />
    );
  } else {
    content = (
      <WorkspaceShell
        header={header}
        left={
          <div className="space-y-10">
            {joinCode && (
              <p className="text-xs text-gray-400">
                Join code <span className="font-mono font-semibold text-white">{joinCode}</span>
              </p>
            )}

            {/* Exam summary: a small table with each section's questions and marks, then the totals. */}
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-gray-300">Exam summary</h3>
              <div className="divide-y divide-white/5 text-sm">
                <div className="grid grid-cols-[1fr_4.5rem_3.5rem] items-center gap-2 pb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                  <span>Section</span>
                  <span className="text-right">Questions</span>
                  <span className="text-right">Marks</span>
                </div>
                {sections.map((s, i) => {
                  const n = s.questions?.length || 0;
                  const marks = (s.questions || []).reduce((m: number, q: any) => m + (Number(q.marks) || 0), 0);
                  return (
                    <div key={s.id ?? s._id ?? i} className="grid grid-cols-[1fr_4.5rem_3.5rem] items-center gap-2 py-2 text-gray-300">
                      <span className="min-w-0 truncate">{s.title || `Section ${i + 1}`}</span>
                      <span className="text-right tabular-nums">{n}</span>
                      <span className="text-right tabular-nums">{marks}</span>
                    </div>
                  );
                })}
                <div className="grid grid-cols-[1fr_4.5rem_3.5rem] items-center gap-2 py-2 font-semibold text-white">
                  <span>Total</span>
                  <span className="text-right tabular-nums">{questionCount}</span>
                  <span className="text-right tabular-nums">{totalMarks}</span>
                </div>
              </div>
            </div>

            <ExamDetailsForm values={details} onChange={(patch) => setDetails((prev) => ({ ...prev, ...patch }))} />
            <div className="space-y-2">
              <label className="text-sm font-semibold text-gray-300">Publish Date & Time</label>
              <p className="text-xs text-gray-500">Students can&apos;t see the exam before this time. Leave blank to publish immediately.</p>
              <DateTimeInput value={publishTime} onChange={(v) => setPublishTime(v)} />
            </div>
          </div>
        }
        bare
        footer={
          <>
            {/* One row on phones: Back on the left, Save and Publish on the right (shorter labels there). */}
            <Button variant="ghost" onClick={() => setPhase("questions")} className={`${ghostButton} whitespace-nowrap px-1 sm:px-4`}>
              <ArrowLeft className="h-4 w-4 mr-1.5" /> Back
            </Button>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={() => handleSaveExam()}
                disabled={isSaving}
                className="bg-amber-500/10 text-amber-300 border-amber-500/30 hover:bg-amber-500/20 h-10 px-3 sm:px-4 whitespace-nowrap text-sm font-semibold"
              >
                {isPublished ? "Save changes" : "Save as Draft"}
              </Button>
              {!isPublished && (
                <Button onClick={() => handleSaveExam("PUBLISHED")} disabled={isSaving} className="bg-green-600 hover:bg-green-700 text-white h-10 px-4 sm:px-6 whitespace-nowrap font-bold text-sm rounded-xl">
                  {isSaving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : publishTime ? (
                    <><span className="sm:hidden">Schedule</span><span className="hidden sm:inline">Schedule & Publish</span></>
                  ) : (
                    <><span className="sm:hidden">Publish</span><span className="hidden sm:inline">Publish Exam</span></>
                  )}
                </Button>
              )}
            </div>
          </>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-3 lg:h-full lg:min-h-0">
      <div className="flex items-center gap-3 shrink-0 pt-3 sm:pt-4">
        <button
          onClick={() => router.push(`/teacher/exams`)}
          aria-label="Back to exams"
          className="inline-flex items-center gap-2 py-1.5 pl-1 pr-3 text-base font-semibold text-gray-300 hover:text-white transition-colors"
        >
          <ArrowLeft className="h-5 w-5" /> Back
        </button>
      </div>
      <div className="flex-1 lg:min-h-0">{content}</div>
    </div>
  );
}
