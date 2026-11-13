"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, List, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { getExamForSubmissionService, getSubmissionByIdService, submitAnswerService, submitExamService } from "@/app/student/student.service";
import { FeedbackModal } from "@/components/FeedbackModal";
import ReactMarkdown from "react-markdown";
import { normalizeCodeBlocks } from "@/lib/markdown";
import { MATH_REMARK_PLUGINS, MATH_REHYPE_PLUGINS } from "@/lib/markdownMath";
import { ContentBlocksView, OptionValue, type ContentBlock, MarkdownCode } from "@/components/QuestionContentBlocks";

// Define a type for our flattened question structure
type FlattenedQuestion = {
  id: string;
  globalIndex: number;
  sectionTitle: string;
  description: string;
  marks: number;
  type: string;
  options: any[];
  images: any[];
  contentBlocks: ContentBlock[];
};

const STORAGE_PREFIX = "abhyas-exam-pending:";

const loadLocalSnapshot = (submissionId: string) => {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + submissionId);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const saveLocalSnapshot = (submissionId: string, answers: Record<string, string[]>, textAnswers: Record<string, string>) => {
  try {
    localStorage.setItem(STORAGE_PREFIX + submissionId, JSON.stringify({ answers, textAnswers }));
  } catch {}
};

const clearLocalSnapshot = (submissionId: string) => {
  try {
    localStorage.removeItem(STORAGE_PREFIX + submissionId);
  } catch {}
};

export default function ExamAttemptPage() {
  const params = useParams();
  const submissionId = params.id as string;
  const router = useRouter();

  const [examData, setExamData] = useState<any>(null);
  const [showNavigator, setShowNavigator] = useState(false);
  const [submissionData, setSubmissionData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSavingAnswer, setIsSavingAnswer] = useState(false);
  const [, setTimeLeft] = useState<number | null>(null);

  // Offline / sync state
  const [isOnline, setIsOnline] = useState<boolean>(typeof navigator !== "undefined" ? navigator.onLine : true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [dirtyVersion, setDirtyVersion] = useState(0);

  // Map of questionId -> selectedOptionIds[]
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [textAnswers, setTextAnswers] = useState<Record<string, string>>({});
  const [savedAnswers, setSavedAnswers] = useState<Record<string, string[]>>({});
  const [savedTextAnswers, setSavedTextAnswers] = useState<Record<string, string>>({});
  
  // Navigation State
  const [currentIndex, setCurrentIndex] = useState(0);

  // Feedback State
  const [showFeedback, setShowFeedback] = useState(false);

  // Exam Instructions State
  const [hasAcceptedInstructions, setHasAcceptedInstructions] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);

  // Refs for offline persistence & sync (avoid stale closures)
  const answersRef = useRef<Record<string, string[]>>({});
  const textAnswersRef = useRef<Record<string, string>>({});
  const dirtyRef = useRef<Set<string>>(new Set());
  const pendingSubmitRef = useRef(false);
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncPromiseRef = useRef<Promise<boolean> | null>(null);
  const runSyncRef = useRef<() => Promise<boolean>>(async () => true);
  const submitRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    if (!submissionId) return;
    
    const fetchData = async () => {
      try {
        const [examRes, subRes] = await Promise.all([
          getExamForSubmissionService(submissionId),
          getSubmissionByIdService(submissionId)
        ]);
        
        const exam = examRes.data || examRes;
        const sub = subRes.data || subRes;
        
        if (sub.status !== "inprogress") {
          clearLocalSnapshot(submissionId);
          toast.info("This exam is already submitted or timeout.");
          router.replace(`/student/results/${submissionId}`);
          return;
        }

        setExamData(exam);
        setSubmissionData(sub);

        // Populate initial answers (server) then overlay any local offline snapshot
        const initialAnswers: Record<string, string[]> = {};
        const initialTextAnswers: Record<string, string> = {};
        if (sub.answers && Array.isArray(sub.answers)) {
          sub.answers.forEach((ans: any) => {
            if (ans.options) initialAnswers[ans.questionId] = ans.options;
            if (ans.textAnswer) initialTextAnswers[ans.questionId] = ans.textAnswer;
          });
        }

        const local = loadLocalSnapshot(submissionId);
        const mergedAnswers = { ...initialAnswers };
        const mergedTextAnswers = { ...initialTextAnswers };
        const dirty = new Set<string>();
        if (local) {
          for (const [qid, opts] of Object.entries(local.answers || {})) {
            mergedAnswers[qid] = opts as string[];
            dirty.add(qid);
          }
          for (const [qid, txt] of Object.entries(local.textAnswers || {})) {
            mergedTextAnswers[qid] = txt as string;
            dirty.add(qid);
          }
        }

        setAnswers(mergedAnswers);
        setSavedAnswers(mergedAnswers);
        setTextAnswers(mergedTextAnswers);
        setSavedTextAnswers(mergedTextAnswers);
        answersRef.current = mergedAnswers;
        textAnswersRef.current = mergedTextAnswers;
        dirtyRef.current = dirty;
        if (dirty.size > 0) setDirtyVersion(v => v + 1);

        // Setup timer based on submission createdAt
        if (sub.createdAt && exam.duration) {
          const startTime = new Date(sub.createdAt).getTime();
          const durationMs = exam.duration * 60 * 1000;
          const endTime = startTime + durationMs;
          const remaining = Math.max(0, Math.floor((endTime - Date.now()) / 1000));
          setTimeLeft(remaining);
        }

      } catch {
        toast.error("Failed to load the exam.");
        router.push("/student");
      } finally {
        setLoading(false);
      }
    };
    
    fetchData();
  }, [submissionId, router]);

  // ── Online / offline detection ──────────────────────────────────────────
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      toast.success("Internet connection restored. Syncing your answers...");
      runSyncRef.current().then((ok) => {
        if (ok && pendingSubmitRef.current) {
          pendingSubmitRef.current = false;
          submitRef.current();
        }
      });
    };
    const handleOffline = () => {
      setIsOnline(false);
      toast.warning("Connection lost. Your answers are saved on this device.");
    };
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // ── Auto-save: debounced sync of any unsaved (dirty) answers when online ─
  useEffect(() => {
    if (!isOnline) return;
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    syncTimerRef.current = setTimeout(() => { runSyncRef.current(); }, 3000);
    return () => {
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    };
  }, [dirtyVersion, isOnline]);

  // Flatten sections into a linear array of questions
  const flattenedQuestions = useMemo<FlattenedQuestion[]>(() => {
    if (!examData || !examData.sections) return [];
    
    let globalIndex = 0;
    const result: FlattenedQuestion[] = [];
    
    examData.sections.forEach((section: any) => {
      if (section.questions) {
        section.questions.forEach((q: any) => {
          result.push({
            id: q.id,
            globalIndex,
            sectionTitle: section.title,
            description: q.description,
            marks: q.marks,
            type: q.type,
            options: q.options || [],
            images: q.images || [],
            contentBlocks: q.contentBlocks || [],
          });
          globalIndex++;
        });
      }
    });
    
    return result;
  }, [examData]);

  const handleTimeUp = async () => {
    if (!navigator.onLine) {
      pendingSubmitRef.current = true;
      toast.error("Time is up! You need internet to submit. It will be submitted automatically when the connection returns.");
      return;
    }
    toast.info("Time is up! Submitting your exam automatically.");
    await submitExamFinal();
  };

  const handleOptionChange = (questionId: string, optionId: string) => {
    const newSelected = [optionId];
    const nextAnswers = { ...answersRef.current, [questionId]: newSelected };
    setAnswers(nextAnswers);
    answersRef.current = nextAnswers;
    saveLocalSnapshot(submissionId, nextAnswers, textAnswersRef.current);
    dirtyRef.current.add(questionId);
    setDirtyVersion(v => v + 1);
  };

  const handleTextAnswerChange = (questionId: string, text: string) => {
    const nextTextAnswers = { ...textAnswersRef.current, [questionId]: text };
    setTextAnswers(nextTextAnswers);
    textAnswersRef.current = nextTextAnswers;
    saveLocalSnapshot(submissionId, answersRef.current, nextTextAnswers);
    dirtyRef.current.add(questionId);
    setDirtyVersion(v => v + 1);
  };

  // ── Sync helpers ────────────────────────────────────────────────────────
  // Sends every locally-dirty answer to the server. Returns true only if all
  // dirty answers were saved successfully (or there were none to save).
  const syncDirtyAnswers = async (): Promise<boolean> => {
    const dirtyIds = Array.from(dirtyRef.current);
    if (dirtyIds.length === 0) return true;
    if (!navigator.onLine) return false;

    setIsSyncing(true);
    let allOk = true;
    try {
      for (const qid of dirtyIds) {
        const q = flattenedQuestions.find((fq) => fq.id === qid);
        if (!q) continue;
        try {
          await submitAnswerService({
            submissionId,
            questionId: qid,
            options: q.type === "mcq" ? answersRef.current[qid] : undefined,
            textAnswer: q.type !== "mcq" ? textAnswersRef.current[qid] : undefined,
          });
          if (q.type === "mcq") {
            setSavedAnswers(prev => ({ ...prev, [qid]: answersRef.current[qid] ?? [] }));
          } else {
            setSavedTextAnswers(prev => ({ ...prev, [qid]: textAnswersRef.current[qid] ?? "" }));
          }
          dirtyRef.current.delete(qid);
        } catch {
          allOk = false;
          break;
        }
      }
    } finally {
      setIsSyncing(false);
    }
    return allOk;
  };

  // Runs a single sync at a time; concurrent callers share the same attempt.
  const runSync = (): Promise<boolean> => {
    if (syncPromiseRef.current) return syncPromiseRef.current;
    const p = syncDirtyAnswers().finally(() => { syncPromiseRef.current = null; });
    syncPromiseRef.current = p;
    return p;
  };


  // Button Handlers
  const handlePrevious = () => {
    if (currentIndex > 0) setCurrentIndex(currentIndex - 1);
  };

  const handleNextSkip = () => {
    if (currentIndex < flattenedQuestions.length - 1) {
      setCurrentIndex(currentIndex + 1);
    }
  };

  const handleSaveAction = async (moveToNext: boolean) => {
    const currentQ = flattenedQuestions[currentIndex];
    const selectedOptions = answers[currentQ.id];
    const textAns = textAnswers[currentQ.id];

    if (currentQ.type === "mcq" && (!selectedOptions || selectedOptions.length === 0)) {
      toast.error("Please select an answer to save, or use 'Next' to skip.");
      return;
    }
    
    if (currentQ.type !== "mcq" && (!textAns || textAns.trim() === "")) {
      toast.error("Please write your answer to save, or use 'Next' to skip.");
      return;
    }

    setIsSavingAnswer(true);

    // If offline, store locally and let auto-sync push it when connection returns
    if (!isOnline) {
      dirtyRef.current.add(currentQ.id);
      setDirtyVersion(v => v + 1);
      if (currentQ.type === "mcq") {
        setSavedAnswers(prev => ({ ...prev, [currentQ.id]: selectedOptions }));
      } else {
        setSavedTextAnswers(prev => ({ ...prev, [currentQ.id]: textAns }));
      }
      setIsSavingAnswer(false);
      toast.info("You're offline. Your answer is saved on this device and will sync automatically.");
      if (moveToNext) {
        if (currentIndex < flattenedQuestions.length - 1) {
          setCurrentIndex(currentIndex + 1);
        } else {
          toast.success("All questions answered! You can now submit the exam.");
        }
      }
      return;
    }

    try {
      await submitAnswerService({
        submissionId,
        questionId: currentQ.id,
        options: currentQ.type === "mcq" ? selectedOptions : undefined,
        textAnswer: currentQ.type !== "mcq" ? textAns : undefined
      });

      // Update saved answers state
      if (currentQ.type === "mcq") {
        setSavedAnswers(prev => ({ ...prev, [currentQ.id]: selectedOptions }));
      } else {
        setSavedTextAnswers(prev => ({ ...prev, [currentQ.id]: textAns }));
      }
      dirtyRef.current.delete(currentQ.id);
      
      if (moveToNext) {
        if (currentIndex < flattenedQuestions.length - 1) {
          setCurrentIndex(currentIndex + 1);
        } else {
          toast.success("All questions answered! You can now submit the exam.");
        }
      } else {
        toast.success("Answer saved successfully.");
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Failed to save answer");
    } finally {
      setIsSavingAnswer(false);
    }
  };

  const submitExamFinal = async () => {
    if (!navigator.onLine) {
      toast.error("You need internet to submit your exam. Please wait for the connection to come back and try again.");
      return;
    }

    setIsSubmitting(true);
    try {
      const synced = await runSync();
      if (!synced) {
        toast.error("Could not save your latest answers. Check your connection and try again.");
        setIsSubmitting(false);
        return;
      }

      await submitExamService(submissionId);
      clearLocalSnapshot(submissionId);
      dirtyRef.current.clear();
      toast.success("Exam submitted successfully!");
      if (examData?.requireFeedback) {
        setShowFeedback(true);
      } else {
        router.push(`/student/results/${submissionId}`);
      }
    } catch (err: any) {
      const message = err.response?.data?.message || "Failed to submit exam";
      if (/already submitted/i.test(message)) {
        clearLocalSnapshot(submissionId);
        toast.info("This exam was already submitted. Redirecting to your results.");
        router.replace(`/student/results/${submissionId}`);
        return;
      }
      toast.error(message);
      setIsSubmitting(false);
    }
  };

  // Keep the latest sync/submit functions available to the online/offline handlers
  useEffect(() => {
    runSyncRef.current = runSync;
    submitRef.current = submitExamFinal;
  });

  const handleSubmitClick = () => {
    if (!isOnline) {
      toast.error("You need internet to submit your exam. Please wait for the connection to come back and try again.");
      return;
    }
    if (!confirm("Are you sure you want to submit your exam? You cannot change your answers after submitting.")) return;
    submitExamFinal();
  };

  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    const pad = (num: number) => num.toString().padStart(2, '0');
    
    if (h > 0) return `${pad(h)}:${pad(m)}:${pad(s)}`;
    return `${pad(m)}:${pad(s)}`;
  };

  const ExamTimer = ({ endTime, onTimeUp }: { endTime: number, onTimeUp: () => void }) => {
    const [timeLeft, setTimeLeft] = useState(() => Math.max(0, Math.floor((endTime - Date.now()) / 1000)));

    useEffect(() => {
      if (timeLeft <= 0) {
        onTimeUp();
        return;
      }

      const timer = setInterval(() => {
        setTimeLeft(prev => Math.max(0, prev - 1));
      }, 1000);

      return () => clearInterval(timer);
    }, [timeLeft]);

    return (
      <div className={`font-mono text-2xl font-bold tracking-wider ${timeLeft < 300 ? 'text-red-400' : 'text-gray-200'}`}>
        {formatTime(timeLeft)}
      </div>
    );
  };

  if (loading) return <div className="flex items-center justify-center h-full bg-[#050505] text-white">Loading Exam...</div>;
  if (!examData) return <div className="flex items-center justify-center h-full bg-[#050505] text-white">Exam not found.</div>;
  if (flattenedQuestions.length === 0) return <div className="flex items-center justify-center h-full bg-[#050505] text-white">No questions in this exam.</div>;

  if (!hasAcceptedInstructions) {
    const totalMarks = flattenedQuestions.reduce((acc, q) => acc + (q.marks || 0), 0);
    const stats = [
      { label: "Duration", value: `${examData.duration || 60} mins`, accent: false },
      { label: "Questions", value: String(flattenedQuestions.length), accent: false },
      { label: "Marks", value: String(totalMarks), accent: true },
      { label: "Sections", value: String(examData.sections?.length || 1), accent: false },
    ];

    return (
      <div className="min-h-screen bg-[#050505] text-white custom-scrollbar overflow-y-auto">
        <div className="max-w-2xl mx-auto w-full px-4 py-8 sm:px-6 sm:py-12 space-y-8 sm:space-y-10">

          {/* Title */}
          <div>
            <p className="text-[11px] font-semibold text-orange-400 uppercase tracking-widest">Title</p>
            <h1 className="text-2xl sm:text-3xl font-bold text-white mt-1.5 tracking-tight break-words">{examData.title}</h1>
          </div>

          {/* Key numbers */}
          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-5 border-y border-white/10 py-5">
            {stats.map((s) => (
              <div key={s.label}>
                <dt className="text-xs text-zinc-500">{s.label}</dt>
                <dd className={`text-xl font-semibold mt-0.5 ${s.accent ? "text-orange-400" : "text-white"}`}>{s.value}</dd>
              </div>
            ))}
          </dl>

          {/* Instructions */}
          <section>
            <h2 className="text-sm font-semibold text-white uppercase tracking-wider">Instructions</h2>
            <ul className="mt-4 space-y-3 pl-5 list-disc marker:text-orange-500 text-sm text-zinc-300 leading-relaxed">
              <li>Stay connected to the internet and do not switch browser tabs.</li>
              <li>Answer all questions before submitting. You cannot change your answers after you submit.</li>
              <li><span className="font-semibold text-white">Save</span> stores your current answer and keeps you on the same question.</li>
              <li><span className="font-semibold text-white">Save &amp; Next</span> stores your answer and moves to the next question.</li>
              <li><span className="font-semibold text-white">Next / Previous</span> moves between questions without saving any changes.</li>
              <li><span className="font-semibold text-white">Submit Exam</span> is at the top right of the screen. Use it once you have finished.</li>
            </ul>
          </section>

          {/* Question navigator colours */}
          <section>
            <h2 className="text-sm font-semibold text-white uppercase tracking-wider">Question colours</h2>
            <div className="mt-4 flex flex-col sm:flex-row sm:flex-wrap gap-x-8 gap-y-3">
              <div className="flex items-center gap-3">
                <div className="w-7 h-7 bg-emerald-600 rounded-md flex items-center justify-center text-xs font-bold text-white shrink-0">1</div>
                <span className="text-sm text-zinc-300">Answered and saved</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-7 h-7 border border-white/25 rounded-md flex items-center justify-center text-xs font-bold text-zinc-400 shrink-0">2</div>
                <span className="text-sm text-zinc-300">Not answered</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-7 h-7 border-2 border-orange-500 bg-orange-500/20 rounded-md flex items-center justify-center text-xs font-bold text-white shrink-0">3</div>
                <span className="text-sm text-zinc-300">Current question</span>
              </div>
            </div>
          </section>

          {/* Confirmation and start */}
          <div className="border-t border-white/10 pt-6 flex flex-col sm:flex-row sm:items-center justify-between gap-5">
            <label className="flex items-start gap-3 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={agreedToTerms}
                onChange={(e) => setAgreedToTerms(e.target.checked)}
                className="mt-0.5 w-4 h-4 accent-orange-500 cursor-pointer shrink-0"
              />
              <span className="text-sm text-zinc-300 leading-snug">
                I have read and understood the instructions. I am ready to start.
              </span>
            </label>

            <Button
              disabled={!agreedToTerms}
              onClick={() => setHasAcceptedInstructions(true)}
              className="w-full sm:w-auto bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white font-semibold text-sm h-11 px-8 rounded-lg shrink-0"
            >
              Proceed to Exam
            </Button>
          </div>

        </div>
      </div>
    );
  }

  const currentQuestion = flattenedQuestions[currentIndex];
  const selectedOptions = answers[currentQuestion.id] || [];
  const textAnswer = textAnswers[currentQuestion.id] || "";

  return (
    <div className="flex flex-col h-full bg-[#050505]">
      {/* Top Header */}
      <header className="relative shrink-0 bg-[#0f0f11] border-b border-white/5 px-3 sm:px-6 py-3 sm:py-4 flex items-center justify-between gap-2 sm:gap-3 shadow-md">
        <div className="min-w-0">
          <h1 className="text-base sm:text-xl font-bold text-white tracking-tight truncate">{examData.title}</h1>
        </div>

        {/* Timer: centred on wide screens, between the title and the buttons on phones */}
        <div className="flex flex-col items-center shrink-0 sm:absolute sm:left-1/2 sm:-translate-x-1/2">
          <span className="text-[10px] font-bold text-gray-500 tracking-widest uppercase mb-1">Time Remaining</span>
          {submissionData?.createdAt && examData?.duration ? (
            <ExamTimer 
              endTime={new Date(submissionData.createdAt).getTime() + examData.duration * 60 * 1000} 
              onTimeUp={handleTimeUp} 
            />
          ) : (
            <div className="font-mono text-2xl font-bold tracking-wider text-gray-200">--:--</div>
          )}
          {(isSyncing || !isOnline) && (
            <span className={`mt-1 text-[10px] font-bold uppercase tracking-widest ${!isOnline ? "text-red-400" : "text-amber-400"}`}>
              {!isOnline ? "● Offline" : "Syncing..."}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* The question navigator is a side panel on wide screens and a drawer on small ones. */}
          <Button
            variant="outline"
            onClick={() => setShowNavigator(true)}
            className="lg:hidden bg-transparent border-white/15 text-gray-200 hover:bg-white/10 hover:text-white px-2.5 sm:px-3"
          >
            <List className="h-4 w-4 sm:mr-1.5" />
            <span className="hidden sm:inline">Questions</span>
          </Button>
          <Button
            onClick={handleSubmitClick}
            disabled={isSubmitting}
            className="bg-orange-600 hover:bg-orange-700 text-white font-semibold transition-all shadow-lg shadow-orange-950/40 text-xs sm:text-sm px-3 sm:px-4"
          >
            {isSubmitting ? "Submitting..." : <>Submit<span className="hidden sm:inline">&nbsp;Exam</span></>}
          </Button>
        </div>
      </header>

      {/* Offline banner */}
      {!isOnline && (
        <div className="shrink-0 bg-red-500/10 border-b border-red-500/30 px-4 sm:px-6 py-2.5 flex items-center justify-center gap-2 text-center">
          <span className="text-xs font-semibold text-red-300">
            Connection lost — your answers are saved on this device. You can keep answering, but submitting requires internet.
          </span>
        </div>
      )}

      {/* Main Split Content */}
      <div className="flex flex-1 min-h-0">
        {showNavigator && <div className="fixed inset-0 z-30 bg-black/60 lg:hidden" onClick={() => setShowNavigator(false)} />}
        
        {/* Left Pane: Question Area */}
        <div className="flex-1 flex flex-col overflow-y-auto custom-scrollbar">
          
          {/* Question Header */}
          <div className="px-4 sm:px-8 py-4 sm:py-6 pb-2 border-b border-white/5">
            <p className="text-amber-400 font-bold text-xs uppercase tracking-widest mb-1">
              {currentQuestion.sectionTitle}
            </p>
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-400 tracking-wide">
                QUESTION {currentIndex + 1} OF {flattenedQuestions.length}
              </h2>
              <span className="text-xs font-semibold text-gray-500 bg-white/5 px-2 py-1 rounded">
                {currentQuestion.marks} Marks
              </span>
            </div>
          </div>

          {/* Question Content */}
          <div className="flex-1 px-4 sm:px-8 py-5 sm:py-8 space-y-6 sm:space-y-8 max-w-4xl">
            <div>
              <div className="text-xl md:text-2xl font-bold text-white leading-snug whitespace-pre-wrap prose prose-invert max-w-none">
                <ReactMarkdown 
                  remarkPlugins={MATH_REMARK_PLUGINS}
                  rehypePlugins={MATH_REHYPE_PLUGINS}
                  components={{
                    pre: ({ children }) => {
                      return (
                        <div className="my-6 rounded-2xl overflow-hidden border border-white/10 bg-[#09090b] shadow-2xl font-normal">
                          <div className="p-6 overflow-x-auto custom-scrollbar">
                            {children}
                          </div>
                        </div>
                      );
                    },
                    code: ({ className, children }) => <MarkdownCode className={className} size="large">{children}</MarkdownCode>,
                    p: ({...props}) => <p className="mb-4 last:mb-0" {...props} />
                  }}
                >
                  {normalizeCodeBlocks(currentQuestion.description || "No question text provided.")}
                </ReactMarkdown>
              </div>
              <ContentBlocksView blocks={currentQuestion.contentBlocks} size="large" />
              {currentQuestion.images && currentQuestion.images.length > 0 && (
                <div className="mt-6 mb-2">
                  <img src={currentQuestion.images[0].url} alt="Question figure" className="max-h-64 object-contain rounded-lg border border-white/10 bg-[#14151f] border-white/15 text-white placeholder:text-zinc-400 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/30/50" />
                </div>
              )}
            </div>

            {currentQuestion.type !== "mcq" ? (
              <div className="space-y-4">
                <textarea
                  value={textAnswer}
                  onChange={(e) => handleTextAnswerChange(currentQuestion.id, e.target.value)}
                  placeholder="Type your descriptive answer here..."
                  className="w-full min-h-[240px] sm:min-h-[400px] bg-[#14151f] text-white border border-white/15 rounded-2xl p-6 focus:outline-none focus:border-white/30 transition-all resize-y shadow-inner text-base font-mono leading-relaxed placeholder:text-zinc-500"
                />
              </div>
            ) : (
              <div className="space-y-4">
                {currentQuestion.options?.map((opt: any, idx: number) => {
                  const isSelected = selectedOptions.includes(opt.id);
                // Map index 0->A, 1->B, etc.
                const letter = String.fromCharCode(65 + idx);
                
                return (
                  <label 
                    key={opt.id} 
                    className={`
                      relative flex items-center p-4 cursor-pointer rounded-xl border-2 transition-all duration-200 group
                      ${isSelected 
                        ? "bg-[#18181b]mber-500/10 border-amber-500/50 text-white" 
                        : "bg-transparent border-white/10 text-gray-300 hover:border-white/30 hover:bg-white/5"}
                    `}
                  >
                    <input 
                      type="radio" 
                      name={`question-${currentQuestion.id}`} 
                      className="sr-only"
                      checked={isSelected}
                      onChange={() => handleOptionChange(currentQuestion.id, opt.id)}
                    />
                    
                    {/* Letter Avatar */}
                    <div className={`
                      flex items-center justify-center w-8 h-8 rounded-md border mr-4 shrink-0 transition-colors font-bold text-sm
                      ${isSelected ? "border-amber-500 bg-[#18181b]mber-600 text-white" : "border-zinc-700 text-white/80 group-hover:border-white/40"}
                    `}>
                      {letter}
                    </div>
                    
                    <span className="text-[15px] leading-relaxed flex-1"><OptionValue value={opt.value} isCode={opt.isCode} size="large" /></span>
                  </label>
                );
              })}
            </div>
            )}
          </div>

          {/* Question Footer Actions */}
          <div className="shrink-0 p-2.5 sm:p-6 sm:px-8 border-t border-white/5 bg-[#0f0f11]/50 flex items-center justify-end">
            {/* Phones: four equal columns that fill the row. From sm up: the usual right-aligned row. */}
            <div className="grid w-full grid-cols-4 gap-1.5 sm:flex sm:w-auto sm:flex-wrap sm:justify-end sm:gap-4">
              <Button
                variant="outline"
                onClick={handlePrevious}
                disabled={currentIndex === 0}
                className="h-9 w-full min-w-0 px-1 text-xs sm:h-9 sm:w-auto sm:px-4 sm:text-sm bg-transparent border-white/10 text-gray-300 hover:text-white hover:bg-white/10"
              >
                <ChevronLeft className="mr-2 h-4 w-4 hidden sm:block" /> <span className="sm:hidden">Prev</span><span className="hidden sm:inline">Previous</span>
              </Button>

              <Button
                variant="outline"
                onClick={handleNextSkip}
                disabled={currentIndex === flattenedQuestions.length - 1}
                className="h-9 w-full min-w-0 px-1 text-xs sm:h-9 sm:w-auto sm:px-4 sm:text-sm bg-transparent border-white/10 text-gray-300 hover:text-white hover:bg-white/10"
              >
                <span className="sm:hidden">Skip</span><span className="hidden sm:inline">Next (Skip)</span> <ChevronRight className="ml-2 h-4 w-4 hidden sm:block" />
              </Button>

              <Button 
                variant="outline"
                onClick={() => handleSaveAction(false)}
                disabled={isSavingAnswer || (currentQuestion.type === "mcq" ? selectedOptions.length === 0 : (!textAnswer || textAnswer.trim() === ""))}
                className="h-9 w-full min-w-0 px-1 text-xs sm:h-9 sm:w-auto sm:px-4 sm:text-sm bg-[#18181b]merald-600/10 border-emerald-500/50 hover:bg-[#18181b]merald-600 hover:text-white text-emerald-400 font-semibold sm:min-w-[100px]"
              >
                {isSavingAnswer ? "Saving..." : "Save"}
              </Button>

              <Button 
                onClick={() => handleSaveAction(true)}
                disabled={isSavingAnswer || currentIndex === flattenedQuestions.length - 1 || (currentQuestion.type === "mcq" ? selectedOptions.length === 0 : (!textAnswer || textAnswer.trim() === ""))}
                className="h-9 w-full min-w-0 px-1 text-xs sm:h-9 sm:w-auto sm:px-4 sm:text-sm bg-orange-600 hover:bg-orange-700 text-white font-semibold sm:min-w-[140px]"
              >
                Save & Next
              </Button>
            </div>
          </div>
        </div>

        {/* Right Pane: Navigator */}
        <aside
          className={`fixed inset-y-0 right-0 z-40 w-72 max-w-[85vw] transition-transform duration-200 lg:static lg:z-auto lg:w-80 lg:max-w-none lg:translate-x-0 border-l border-white/5 bg-[#0f0f11] shrink-0 flex flex-col ${showNavigator ? "translate-x-0" : "translate-x-full"}`}
        >
          <div className="p-4 sm:p-6 border-b border-white/5 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <button onClick={() => setShowNavigator(false)} className="lg:hidden -ml-1 p-1 rounded-md text-gray-400 hover:text-white hover:bg-white/10" aria-label="Close navigator">
                <X className="h-5 w-5" />
              </button>
              <h3 className="text-lg font-bold text-white">Navigator</h3>
            </div>
            {/* Compute answered count based on local state */}
            <span className="text-xs font-semibold text-gray-400 bg-[#14151f] border-white/15 text-white placeholder:text-zinc-400 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/30/20 px-2 py-1 rounded">
              {Object.keys(savedAnswers).filter(k => savedAnswers[k].length > 0).length} / {flattenedQuestions.length} Answered
            </span>
          </div>

          {/* Section Tabs */}
          {examData.sections && examData.sections.length > 0 && (
            <div className="px-6 py-3 border-b border-white/5 flex gap-2 overflow-x-auto custom-scrollbar shrink-0">
              {examData.sections.map((sec: any) => {
                const isActive = currentQuestion.sectionTitle === sec.title;
                return (
                  <button
                    key={sec.title}
                    onClick={() => {
                      const firstQIndex = flattenedQuestions.findIndex(q => q.sectionTitle === sec.title);
                      if (firstQIndex !== -1) setCurrentIndex(firstQIndex);
                    }}
                    className={`
                      px-3 py-1.5 rounded-md text-xs font-bold transition-all whitespace-nowrap
                      ${isActive 
                        ? "bg-orange-600 text-white shadow-md shadow-blue-900/20" 
                        : "bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white"}
                    `}
                  >
                    {sec.title}
                  </button>
                );
              })}
            </div>
          )}
          
          <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
            <div className="grid grid-cols-5 gap-2">
              {flattenedQuestions
                .filter((q) => q.sectionTitle === currentQuestion.sectionTitle)
                .map((q) => {
                const idx = q.globalIndex;
                const isCurrent = idx === currentIndex;
                const isAnswered = q.type === "mcq" 
                  ? (savedAnswers[q.id] && savedAnswers[q.id].length > 0)
                  : (savedTextAnswers[q.id] && savedTextAnswers[q.id].trim() !== "");
                let bgColor = "bg-transparent";
                let borderColor = "border-white/15";
                let textColor = "text-gray-400";

                if (isAnswered) {
                  bgColor = "bg-emerald-600";
                  borderColor = "border-emerald-500";
                  textColor = "text-white";
                }

                if (isCurrent) {
                  borderColor = "border-2 border-orange-500 ring-2 ring-orange-500/30";
                  textColor = "text-white font-bold";
                }

                return (
                  <button
                    key={q.id}
                    onClick={() => {
                      setCurrentIndex(idx);
                      setShowNavigator(false);
                    }}
                    className={`
                      aspect-square rounded-lg flex items-center justify-center text-sm font-bold border transition-all cursor-pointer outline-none focus:outline-none
                      hover:border-orange-400
                      ${bgColor} ${borderColor} ${textColor}
                    `}
                  >
                    {idx + 1}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Navigator Legend */}
          <div className="shrink-0 p-6 border-t border-white/5 bg-[#050505]/50">
            <div className="grid grid-cols-2 gap-y-3">
              <div className="flex items-center gap-2 text-xs text-gray-400 font-medium">
                <div className="w-3 h-3 bg-emerald-600 rounded-sm"></div> Answered
              </div>
              <div className="flex items-center gap-2 text-xs text-gray-400 font-medium">
                <div className="w-3 h-3 border border-white/20 rounded-sm"></div> Unanswered
              </div>

              <div className="flex items-center gap-2 text-xs text-gray-400 font-medium">
                <div className="w-3 h-3 border-2 border-orange-500 rounded-sm bg-orange-500/20"></div> Current
              </div>
            </div>
          </div>
        </aside>

      </div>

      {showFeedback && (
        <FeedbackModal
          examId={examData.id}
          submissionId={submissionId}
          hasTextQuestions={flattenedQuestions.some(q => q.type !== "mcq")}
          onClose={() => router.push(`/student/results/${submissionId}`)}
          onSuccess={() => router.push(`/student/results/${submissionId}`)}
        />
      )}
    </div>
  );
}
