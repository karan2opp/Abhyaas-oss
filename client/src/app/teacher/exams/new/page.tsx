"use client";

import React, { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";

import { createExamService, updateExamService, deleteExamService } from "../exam.service";
import { QuestionBuilder, AiExamGeneratorForm, WorkspaceParts } from "./QuestionBuilder";
import { PyqFlow, clearPyqProgress } from "./PyqFlow";
import { SourceFlow } from "./SourceFlow";
import {
  ExamDetailsForm,
  ExamDetails,
  EMPTY_EXAM_DETAILS,
  PLACEHOLDER_EXAM_TITLE,
  suggestTitleFromSections,
  publishProblem,
  examDetailsPayload,
} from "./ExamDetailsForm";
import { WorkspaceShell, ModePicker, CreationMode } from "./workspace";
import QuestionReviewChat from "@/components/QuestionReviewChat";
import { useExamBuilderStore } from "@/store/useExamBuilderStore";
import { DateTimeInput } from "@/components/DateTimeInput";

// Picking how to build the exam creates a working copy so questions have somewhere to be written. It stays hidden
// (status UNSAVED) until the teacher chooses Save as Draft or Publish; leaving without saving asks first. The details
// students see (title, timing, instructions) are filled in at the end, on the publish step.
type Phase = "build" | "review" | "publish";

const primaryButton = "bg-purple-600 hover:bg-purple-700 text-white h-10 px-6 font-bold text-sm rounded-xl shadow-lg shadow-purple-950/40";
const ghostButton = "text-gray-400 hover:text-white h-10 px-4 text-sm font-semibold";

// A refresh in the middle of creating an exam would otherwise forget which exam is being built, and the questions already
// written into it would be lost. This tab remembers it while the teacher is building, and forgets it when they leave the
// page any normal way.
const WIZARD_KEY = "new-exam-wizard";
type WizardSnapshot = { examId: string; joinCode: string; mode: CreationMode | null; phase: "build" | "review" };

function NewExamBuilderContent() {
  const router = useRouter();
  const { resetStore, isAiMode } = useExamBuilderStore();
  const [isMounted, setIsMounted] = useState(false);

  const [mode, setMode] = useState<CreationMode | null>(null);
  const [phase, setPhase] = useState<Phase>("build");
  const [isCreating, setIsCreating] = useState(false);

  const [examId, setExamId] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState("");
  const [details, setDetails] = useState<ExamDetails>(EMPTY_EXAM_DETAILS);
  const [sections, setSections] = useState<any[]>([]);
  // The review chat is a full view of its own, opened from the question list, instead of a panel beside it.
  const [showReview, setShowReview] = useState(false);
  const [publishTime, setPublishTime] = useState("");
  // How the teacher wants written answers written and checked. Optional; the grading guides are written from it afterwards.
  const [evaluationScheme, setEvaluationScheme] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  // Nothing about the exam shows in the teacher's lists until it is saved; this turns true on Save as Draft or Publish.
  // From then on every change is saved as it is made, so leaving never asks again.
  const [isSaved, setIsSaved] = useState(false);
  // Where the teacher was heading when we stopped to ask about saving; null while no question is open.
  const [leaveTo, setLeaveTo] = useState<string | null>(null);

  useEffect(() => {
    setIsMounted(true);
    // The builder store is persisted per tab; a leftover AI-mode flag would open the wrong view inside the question list.
    resetStore();
    // After a page refresh, carry on where the teacher was.
    try {
      const raw = sessionStorage.getItem(WIZARD_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as WizardSnapshot;
        setExamId(saved.examId);
        setJoinCode(saved.joinCode);
        setMode(saved.mode);
        setPhase(saved.phase === "review" ? "review" : "build");
      }
    } catch {
      // Storage can be blocked or hold something unreadable; start from the beginning.
    }
    // Leaving the page normally (back arrow, saving, another link) forgets it. A refresh never reaches this.
    return () => {
      try {
        sessionStorage.removeItem(WIZARD_KEY);
      } catch {
        // nothing to clean up
      }
    };
  }, [resetStore]);

  useEffect(() => {
    if (!isMounted) return;
    try {
      if (examId) {
        // The publish step reopens on the question list, which is where its numbers come from.
        sessionStorage.setItem(WIZARD_KEY, JSON.stringify({ examId, joinCode, mode, phase: phase === "build" ? "build" : "review" } satisfies WizardSnapshot));
      }
    } catch {
      // Not remembering is harmless.
    }
  }, [isMounted, examId, joinCode, mode, phase]);

  const questionCount = useMemo(() => sections.reduce((n, s) => n + (s.questions?.length || 0), 0), [sections]);
  const hasWrittenQuestions = useMemo(() => sections.some((s) => (s.questions || []).some((q: any) => q.type === "descriptive")), [sections]);
  const totalMarks = useMemo(
    () => sections.reduce((sum, s) => sum + (s.questions || []).reduce((m: number, q: any) => m + (Number(q.marks) || 0), 0), 0),
    [sections]
  );

  // The first pick creates the draft; picking again later (after going back) reuses it.
  const handlePickMode = async (picked: CreationMode) => {
    if (examId) {
      setMode(picked);
      return;
    }
    setIsCreating(true);
    try {
      const data = await createExamService({ title: PLACEHOLDER_EXAM_TITLE, type: "ON_DEMAND", duration: 60, instructions: [], totalMarks: 0, status: "UNSAVED" });
      const newExam = data.data || data;
      setExamId(newExam.id || newExam._id);
      if (newExam.joinCode) setJoinCode(newExam.joinCode);
      setMode(picked);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || err.message || "Failed to start a new exam");
    } finally {
      setIsCreating(false);
    }
  };

  const goToReview = () => setPhase("review");

  // Suggest a title from the subject so the teacher rarely has to type one.
  const goToPublish = () => {
    setDetails((prev) => (prev.title.trim() ? prev : { ...prev, title: suggestTitleFromSections(sections) }));
    setPhase("publish");
  };

  const handleSaveExam = async (status: "DRAFT" | "PUBLISHED", to?: string) => {
    if (!examId) return;
    const withTitle = details.title.trim() ? details : { ...details, title: suggestTitleFromSections(sections) || PLACEHOLDER_EXAM_TITLE };
    if (status === "PUBLISHED") {
      const problem = publishProblem(withTitle);
      if (problem) {
        toast.error(problem);
        setPhase("publish");
        return;
      }
      if (publishTime && withTitle.startTime && new Date(publishTime) >= new Date(withTitle.startTime)) {
        toast.error("Publish date and time must be before the exam's start time");
        return;
      }
    }
    setIsSaving(true);
    try {
      await updateExamService(examId, {
        ...examDetailsPayload(withTitle),
        publishTime: publishTime ? new Date(publishTime).toISOString() : null,
        evaluationScheme: evaluationScheme.trim() || null,
        status,
      });
      toast.success(status === "PUBLISHED" ? (publishTime ? "Exam scheduled and published!" : "Exam published successfully!") : "Exam saved as draft");
      setIsSaved(true);
      resetStore();
      router.push(to ?? `/teacher/exams`);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || err.message || "Failed to save exam");
    } finally {
      setIsSaving(false);
    }
  };

  // ── Leaving the page ──────────────────────────────────────────────────
  // Worth asking about only once there are questions to keep; before that the working copy is simply dropped.
  const needsSavePrompt = !!examId && !isSaved && phase !== "build" && questionCount > 0;

  const goTo = (href: string) => {
    resetStore();
    router.push(href);
  };

  // An exam that was never saved can't be found again, so its working copy goes away.
  const discardAndLeave = async (href: string) => {
    if (examId) {
      clearPyqProgress(examId);
      await deleteExamService(examId).catch(() => {});
    }
    goTo(href);
  };

  // Once the exam is saved everything is saved automatically, so nothing is asked.
  const requestLeave = (href: string) => {
    if (!examId || isSaved) return goTo(href);
    if (needsSavePrompt) return setLeaveTo(href);
    void discardAndLeave(href);
  };
  const requestLeaveRef = useRef(requestLeave);
  requestLeaveRef.current = requestLeave;

  // Links elsewhere on the page (the sidebar, for example) are stopped too, so the question is asked in one place.
  useEffect(() => {
    if (!examId || isSaved) return;
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
      const link = (e.target as HTMLElement | null)?.closest("a[href]") as HTMLAnchorElement | null;
      if (!link || link.target === "_blank" || link.origin !== window.location.origin || link.pathname === window.location.pathname) return;
      e.preventDefault();
      e.stopPropagation();
      requestLeaveRef.current(link.pathname + link.search);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [examId, isSaved]);

  // Closing the tab can't show our own question, so the browser asks instead.
  useEffect(() => {
    if (!needsSavePrompt) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [needsSavePrompt]);

  if (!isMounted) return null;

  const modePicker = (
    <WorkspaceShell
      bare
      left={
        <div className="mx-auto flex min-h-[65dvh] w-full max-w-2xl flex-col justify-center space-y-4">
          {isCreating ? (
            <div className="flex items-center gap-2 py-10 text-sm text-gray-400">
              <Loader2 className="h-4 w-4 animate-spin" /> Starting your exam...
            </div>
          ) : (
            <ModePicker selected={null} onSelect={(m) => void handlePickMode(m)} hideHeading />
          )}
        </div>
      }
    />
  );

  const buildShell = (parts: WorkspaceParts) => <WorkspaceShell left={parts.left} right={parts.right} footer={parts.footer} fill={parts.fill} bare={parts.bare} />;
  // "Back" from the first build step returns to the mode picker; the draft is kept and reused.
  const backToModes = () => setMode(null);

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
              <QuestionBuilder
                examId={examId}
                sectionsState={{ sections, setSections }}
                showReviewAgent={false}
                onPickMode={(picked) => {
                  setMode(picked);
                  setPhase("build");
                }}
              />
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
              {/* Side by side on phones too (shorter labels there so both fit on one row). */}
              <Button variant="ghost" onClick={() => handleSaveExam("DRAFT")} disabled={isSaving} className={`${ghostButton} whitespace-nowrap px-2 sm:px-4`}>
                <span className="sm:hidden">Save as Draft</span><span className="hidden sm:inline">Save as Draft & Exit</span>
              </Button>
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
        left={
          <div className="space-y-10">
            {joinCode && (
              <p className="text-xs text-gray-400">
                Join code <span className="font-mono font-semibold text-white">{joinCode}</span>
              </p>
            )}

            {/* Exam summary: how many questions each section has, then the totals. */}
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-gray-300">Exam summary</h3>
              {/* A small table: the name on the left, Questions and Marks in their own right-aligned columns. */}
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

            {/* Only asked when the exam has written questions: it decides how their grading guides are written. */}
            {hasWrittenQuestions && (
              <div className="space-y-2">
                <label htmlFor="evaluation-scheme" className="text-sm font-semibold text-gray-300">How should students answer, and how will you evaluate?</label>
                <p className="text-xs text-gray-500">
                  Optional. For example: &quot;For 5 marks, a definition, an explanation and one example. Don&apos;t deduct for spelling.&quot; The grading guide for each written question is
                  prepared from this after you save. Leave blank to use the standard guide.
                </p>
                <Textarea
                  id="evaluation-scheme"
                  value={evaluationScheme}
                  onChange={(e) => setEvaluationScheme(e.target.value)}
                  maxLength={4000}
                  rows={4}
                  placeholder="Describe how you check answers…"
                  className="text-white placeholder:text-zinc-500"
                />
              </div>
            )}
          </div>
        }
        bare
        footer={
          <>
            {/* One row on phones too: Back on the left, Save as Draft and Publish on the right (shorter labels there). */}
            <Button variant="ghost" onClick={() => setPhase("review")} className={`${ghostButton} whitespace-nowrap px-1 sm:px-4`}>
              <ArrowLeft className="h-4 w-4 mr-1.5" /> <span className="sm:hidden">Back</span><span className="hidden sm:inline">Previous</span>
            </Button>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={() => handleSaveExam("DRAFT")}
                disabled={isSaving}
                className="bg-amber-500/10 text-amber-300 border-amber-500/30 hover:bg-amber-500/20 h-10 px-3 sm:px-4 whitespace-nowrap text-sm font-semibold"
              >
                Save as Draft
              </Button>
              <Button onClick={() => handleSaveExam("PUBLISHED")} disabled={isSaving} className="bg-green-600 hover:bg-green-700 text-white h-10 px-4 sm:px-6 whitespace-nowrap font-bold text-sm rounded-xl">
                {isSaving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : publishTime ? (
                  <><span className="sm:hidden">Schedule</span><span className="hidden sm:inline">Schedule & Publish</span></>
                ) : (
                  <><span className="sm:hidden">Publish</span><span className="hidden sm:inline">Publish Exam</span></>
                )}
              </Button>
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
          onClick={() => requestLeave(`/teacher/exams`)}
          aria-label="Back to exams"
          className="inline-flex items-center gap-2 py-1.5 pl-1 pr-3 text-base font-semibold text-gray-300 hover:text-white transition-colors"
        >
          <ArrowLeft className="h-5 w-5" /> Back
        </button>
      </div>
      <div className="flex-1 lg:min-h-0">{content}</div>

      <Dialog open={leaveTo !== null} onOpenChange={(open) => !open && setLeaveTo(null)}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Save this exam as a draft?</DialogTitle>
            <DialogDescription>
              You haven&apos;t saved this exam yet. Save it as a draft to keep it and come back to it later. After that, every change is saved automatically.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setLeaveTo(null)} className={ghostButton}>
              Keep editing
            </Button>
            <Button
              variant="outline"
              onClick={() => leaveTo && void discardAndLeave(leaveTo)}
              disabled={isSaving}
              className="h-10 border-red-500/30 bg-red-500/10 text-sm font-semibold text-red-300 hover:bg-red-500/20"
            >
              Discard
            </Button>
            <Button onClick={() => leaveTo && void handleSaveExam("DRAFT", leaveTo)} disabled={isSaving} className={primaryButton}>
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save as draft"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function NewExamBuilder() {
  return (
    <Suspense fallback={<div className="p-4 sm:p-6 md:p-10 text-white text-center">Loading...</div>}>
      <NewExamBuilderContent />
    </Suspense>
  );
}
