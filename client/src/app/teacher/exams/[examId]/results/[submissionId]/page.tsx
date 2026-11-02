"use client";

import React, { useState, useEffect, useRef } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Check, X, Bot, User, MessageSquare, PanelRightClose, PanelRightOpen } from "lucide-react";
import { getSubmissionByIdService, getExamForSubmissionService } from "@/app/student/student.service";
import { gradeExamSubmissionService, evaluateExamSubmissionWithAiService } from "@/app/teacher/exams/exam.service";
import { toast } from "sonner";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import { normalizeCodeBlocks } from "@/lib/markdown";
import { MATH_REMARK_PLUGINS, MATH_REHYPE_PLUGINS } from "@/lib/markdownMath";
import { ContentBlocksView, OptionValue, MarkdownCode } from "@/components/QuestionContentBlocks";


export default function ResultsPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const submissionId = params.submissionId as string;
  const examId = params.examId as string;
  const router = useRouter();
  const returnTo = searchParams.get("returnTo");

  const [submission, setSubmission] = useState<any>(null);
  const [exam, setExam] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // Sidebar toggle state
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  const [selectedSectionId, setSelectedSectionId] = useState<string>("");
  const [selectedQuestionId, setSelectedQuestionId] = useState<string>("");

  const [marksByAnswer, setMarksByAnswer] = useState<Record<string, string>>({});
  const [feedbackByAnswer, setFeedbackByAnswer] = useState<Record<string, string>>({});
  const [overallFeedbackInput, setOverallFeedbackInput] = useState("");
  const [showQuestionFeedback, setShowQuestionFeedback] = useState(false);
  const [showOverallFeedback, setShowOverallFeedback] = useState(false);
  const [savingGrade, setSavingGrade] = useState(false);
  const [evaluatingAi, setEvaluatingAi] = useState(false);
  const gradingInitializedRef = useRef(false);

  useEffect(() => {
    if (!submissionId) return;

    const fetchResult = async () => {
      try {
        const [subRes, examRes] = await Promise.all([
          getSubmissionByIdService(submissionId),
          getExamForSubmissionService(submissionId)
        ]);

        const subData = subRes.data || subRes;
        const examData = examRes.data || examRes;

        if (subData.status === "inprogress") {
          toast.info("This exam is still in progress by the student.");
          router.replace(`/teacher/exams/${examId}/results`);
          return;
        }

        setSubmission(subData);
        setExam(examData);
        
        if (examData?.sections?.length > 0 && !selectedSectionId) {
          const firstSection = examData.sections[0];
          setSelectedSectionId(firstSection.id);
          if (firstSection.questions?.length > 0) {
            setSelectedQuestionId(firstSection.questions[0].id);
          }
        }
      } catch {
        toast.error("Failed to load results.");
        router.push(`/teacher/exams/${examId}/results`);
      } finally {
        setLoading(false);
      }
    };

    fetchResult();
    
    let interval: NodeJS.Timeout;
    if (submission?.status === "evaluating") {
      interval = setInterval(() => {
        fetchResult();
      }, 5000);
    }
    
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [submissionId, router, submission?.status, selectedSectionId]);

  useEffect(() => {
    if (submission && submission.status !== "evaluating" && !gradingInitializedRef.current) {
      const marks: Record<string, string> = {};
      const feedback: Record<string, string> = {};
      (submission.answers || []).forEach((a: any) => {
        marks[a.id] = a.marksAwarded !== null && a.marksAwarded !== undefined ? String(a.marksAwarded) : "";
        feedback[a.id] = a.feedback || "";
      });
      setMarksByAnswer(marks);
      setFeedbackByAnswer(feedback);
      setOverallFeedbackInput(submission.overallFeedback || "");
      gradingInitializedRef.current = true;
    }
  }, [submission]);

  const refetchSubmission = async () => {
    try {
      const subRes = await getSubmissionByIdService(submissionId);
      gradingInitializedRef.current = false;
      setSubmission(subRes.data || subRes);
    } catch {
      toast.error("Failed to refresh submission");
    }
  };

  const findQuestion = (questionId: string) => {
    for (const section of exam?.sections || []) {
      const q = section.questions?.find((q: any) => q.id === questionId);
      if (q) return q;
    }
    return null;
  };

  const handleSaveGrade = async () => {
    if (!submission) return;
    for (const a of submission.answers) {
      const q = findQuestion(a.questionId);
      const val = marksByAnswer[a.id];
      if (val === undefined || val === "" || isNaN(parseFloat(val))) {
        toast.error("Enter marks for every question before saving");
        return;
      }
      const parsed = parseFloat(val);
      if (parsed < 0 || (q && parsed > q.marks)) {
        toast.error(`Marks for "${q?.description?.slice(0, 40)}..." cannot exceed ${q?.marks}`);
        return;
      }
    }

    setSavingGrade(true);
    try {
      await gradeExamSubmissionService(submissionId, {
        answers: submission.answers.map((a: any) => ({
          answerId: a.id,
          marksAwarded: parseFloat(marksByAnswer[a.id]),
          feedback: feedbackByAnswer[a.id] || undefined,
        })),
        overallFeedback: overallFeedbackInput.trim() || undefined,
      });
      toast.success("Grade saved");
      await refetchSubmission();
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Failed to save grade");
    } finally {
      setSavingGrade(false);
    }
  };

  const handleEvaluateWithAi = async () => {
    setEvaluatingAi(true);
    try {
      await evaluateExamSubmissionWithAiService(submissionId, { mode: "marks_and_feedback" });
      toast.success("AI evaluation complete");
      await refetchSubmission();
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Failed to run AI evaluation");
    } finally {
      setEvaluatingAi(false);
    }
  };

  if (loading) return <div className="p-4 sm:p-6 md:p-10 text-white text-center">Loading results...</div>;
  if (!submission || !exam) return <div className="p-4 sm:p-6 md:p-10 text-white text-center">Result not found.</div>;

  const score = submission.score ?? 0;
  const totalMarks = exam.totalMarks ?? 0;
  const percentage = totalMarks > 0 ? Math.round((score / totalMarks) * 100) : 0;

  if (submission.status === "evaluating") {
    return (
      <div className="p-4 sm:p-6 md:p-10 h-full flex flex-col items-center justify-center">
        <div className="w-16 h-16 border-4 border-orange-500 border-t-transparent rounded-full animate-spin mb-6"></div>
        <h2 className="text-xl font-bold text-white tracking-wide">Evaluating...</h2>
      </div>
    );
  }

  let colorClass = "text-red-400";
  let bgClass = "bg-red-500/10";
  let borderClass = "border-red-500/20";
  let message = "Needs Improvement";
  
  if (percentage >= 80) {
    colorClass = "text-emerald-400";
    bgClass = "bg-[#18181b]merald-500/10";
    borderClass = "border-emerald-500/20";
    message = "Excellent";
  } else if (percentage >= 50) {
    colorClass = "text-yellow-400";
    bgClass = "bg-yellow-500/10";
    borderClass = "border-yellow-500/20";
    message = "Good Effort";
  }

  let correctCount = 0;
  let incorrectCount = 0;
  let skippedCount = 0;
  let totalQuestions = 0;
  
  exam.sections?.forEach((s: any) => {
    s.questions?.forEach((q: any) => {
      totalQuestions++;
      const ans = submission.answers?.find((a: any) => a.questionId === q.id);
      if (!ans) {
        skippedCount++;
      } else {
        if (q.type !== 'descriptive') {
          if (ans.isCorrect === true) correctCount++;
          else incorrectCount++;
        }
      }
    });
  });

  const currentSection = exam.sections?.find((s: any) => s.id === selectedSectionId);
  const isCurrentSectionDescriptive = currentSection?.questions?.some((q: any) => q.type === "descriptive");
  const selectedQuestion = currentSection?.questions?.find((q: any) => q.id === selectedQuestionId);
  const selectedAnswer = submission.answers?.find((a: any) => a.questionId === selectedQuestionId);
  const isDescriptive = selectedQuestion?.type === "descriptive";
  const questionIndex = currentSection?.questions?.findIndex((q: any) => q.id === selectedQuestionId) ?? 0;

  const renderNavigationSidebar = (containerClass: string) => (
    <div className={containerClass}>
      <Card className="bg-[#0f0f11] border-white/5 md:h-full flex flex-col md:max-h-full md:overflow-hidden rounded-2xl">
        <CardHeader className="pb-3 border-b border-white/5 shrink-0 px-5 pt-4">
          <CardTitle className="text-base font-bold text-white flex items-center justify-between">
            <span>Questions Bar</span>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400 font-normal">{totalQuestions} Total</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-gray-400 hover:text-white hover:bg-white/5 rounded-lg"
                onClick={() => setIsSidebarOpen(false)}
                title="Collapse Questions Bar"
              >
                <PanelRightClose className="h-4 w-4" />
              </Button>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 flex-1 md:overflow-y-auto custom-scrollbar">
          {exam.sections?.length > 1 && (
            <div className="mb-4 flex flex-col gap-1.5">
              {exam.sections.map((section: any) => (
                <button
                  key={section.id}
                  onClick={() => {
                    setSelectedSectionId(section.id);
                    if (section.questions?.length > 0) {
                      setSelectedQuestionId(section.questions[0].id);
                    }
                  }}
                  className={`text-left px-3 py-1.5 rounded-lg text-xs transition-colors ${
                    selectedSectionId === section.id
                      ? "bg-orange-500/20 text-orange-400 border border-orange-500/30 font-medium"
                      : "text-gray-400 hover:bg-white/5"
                  }`}
                >
                  {section.title}
                </button>
              ))}
            </div>
          )}
          
          <div className="grid grid-cols-5 gap-2">
            {currentSection?.questions?.map((q: any, idx: number) => {
              const ans = submission.answers?.find((a: any) => a.questionId === q.id);
              let btnClass = "bg-gray-500/10 text-gray-400 border-gray-500/20 hover:bg-gray-500/20";
              
              if (ans) {
                if (q.type === 'descriptive') {
                  if (ans.marksAwarded >= q.marks) {
                    btnClass = "bg-[#18181b]merald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-[#18181b]merald-500/20";
                  } else if (ans.marksAwarded > 0) {
                    btnClass = "bg-yellow-500/10 text-yellow-400 border-yellow-500/20 hover:bg-yellow-500/20";
                  } else {
                    btnClass = "bg-red-500/10 text-red-400 border-red-500/20 hover:bg-red-500/20";
                  }
                } else {
                  if (ans.isCorrect === true) {
                    btnClass = "bg-[#18181b]merald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-[#18181b]merald-500/20";
                  } else {
                    btnClass = "bg-red-500/10 text-red-400 border-red-500/20 hover:bg-red-500/20";
                  }
                }
              }

              const isSelected = selectedQuestionId === q.id;
              if (isSelected) {
                btnClass += " ring-2 ring-blue-500 ring-offset-2 ring-offset-[#0f0f11]";
              }
              
              return (
                <button
                  key={q.id}
                  onClick={() => setSelectedQuestionId(q.id)}
                  className={`w-9 h-9 shrink-0 rounded-lg flex items-center justify-center font-bold text-xs border transition-all ${btnClass}`}
                >
                  {idx + 1}
                </button>
              );
            })}
          </div>

          <div className="mt-6 pt-4 border-t border-white/5 space-y-2 text-[11px] text-gray-400">
            {!isCurrentSectionDescriptive && (
              <>
                <div className="flex items-center gap-2"><div className="w-2.5 h-2.5 rounded-full bg-[#18181b]merald-500/20 border border-emerald-500/40"></div> Correct</div>
                <div className="flex items-center gap-2"><div className="w-2.5 h-2.5 rounded-full bg-red-500/20 border border-red-500/40"></div> Incorrect</div>
              </>
            )}
            {isCurrentSectionDescriptive && (
              <>
                <div className="flex items-center gap-2"><div className="w-2.5 h-2.5 rounded-full bg-[#18181b]merald-500/20 border border-emerald-500/40"></div> Full marks</div>
                <div className="flex items-center gap-2"><div className="w-2.5 h-2.5 rounded-full bg-yellow-500/20 border border-yellow-500/40"></div> Partial marks</div>
                <div className="flex items-center gap-2"><div className="w-2.5 h-2.5 rounded-full bg-red-500/20 border border-red-500/40"></div> Zero marks</div>
              </>
            )}
            <div className="flex items-center gap-2"><div className="w-2.5 h-2.5 rounded-full bg-gray-500/20 border border-gray-500/40"></div> Skipped</div>
          </div>
        </CardContent>
      </Card>
    </div>
  );

  return (
    <div className="p-3 sm:p-4 h-full flex-1 flex flex-col bg-[#050505] overflow-y-auto md:overflow-hidden">
      <div className="w-full flex flex-col min-h-full md:h-full md:overflow-hidden gap-3">
        
        {/* TOP BAR */}
        <div className="flex flex-wrap items-center justify-between gap-4 pb-3 border-b border-white/5 shrink-0">
          <div className="flex items-center gap-3">
            <Link href={returnTo || `/teacher/exams/${examId}/results`} className="inline-flex items-center text-gray-400 hover:text-white transition-colors text-xs font-semibold">
              <ArrowLeft className="h-4 w-4 mr-1.5" />
              Back
            </Link>
            <span className="text-gray-700">|</span>
            <h1 className="text-sm sm:text-base font-bold text-white truncate max-w-xs sm:max-w-md">{exam.title}</h1>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 bg-[#0f0f11] px-3 py-1.5 rounded-xl border border-white/10 text-xs">
              <span className="text-gray-400">Student:</span>
              <span className="text-white font-semibold">{submission.user?.name || "Student"}</span>
            </div>
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border ${borderClass} ${bgClass} text-xs font-bold`}>
              <span className="text-gray-400 font-normal">Marks:</span>
              <span className={colorClass}>{score} / {totalMarks} ({percentage}%)</span>
            </div>
            <span className="text-xs px-2.5 py-1.5 rounded-xl bg-[#18181b]merald-500/10 text-emerald-400 border border-emerald-500/20 font-bold uppercase tracking-wider">
              {submission.status}
            </span>

            {/* Questions Bar Toggle */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="bg-[#0f0f11] hover:bg-white/5 text-gray-300 hover:text-white border-white/10 text-xs h-8 px-3 rounded-xl flex items-center gap-1.5 ml-2"
              title={isSidebarOpen ? "Collapse Questions Bar" : "Open Questions Bar"}
            >
              {isSidebarOpen ? (
                <>
                  <PanelRightClose className="h-3.5 w-3.5 text-orange-400" />
                  <span>Hide Questions Bar</span>
                </>
              ) : (
                <>
                  <PanelRightOpen className="h-3.5 w-3.5 text-orange-400" />
                  <span>Open Questions Bar</span>
                </>
              )}
            </Button>
          </div>
        </div>

        {/* MAIN WORKSPACE */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 flex-1 md:min-h-0 h-full">
          
          {/* LEFT SIDE */}
          <div className={`${isSidebarOpen ? "md:col-span-3" : "md:col-span-4"} flex flex-col flex-1 h-full min-h-0 min-w-0 transition-all duration-300`}>
            {selectedQuestion && (
              <Card className="bg-[#0f0f11] border-white/5 shadow-2xl flex-1 flex flex-col rounded-2xl h-full min-h-0 overflow-hidden">
                
                {/* Question Header */}
                <CardHeader className="border-b border-white/5 pb-3 p-4 shrink-0 bg-white/[0.01]">
                  <div className="flex justify-between items-start gap-4">
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center gap-2">
                        <span className={`px-2.5 py-0.5 rounded-md text-[10px] uppercase font-bold tracking-wider ${selectedQuestion.type === 'mcq' ? 'bg-orange-500/10 text-orange-400 border border-orange-500/30' : 'bg-[#18181b]mber-500/10 text-amber-400 border border-amber-500/20'}`}>
                          {selectedQuestion.type === 'mcq' ? 'Multiple Choice' : 'Descriptive'}
                        </span>
                      </div>
                      <div className="text-base sm:text-lg font-medium text-white leading-relaxed prose prose-invert max-w-none">
                        <ReactMarkdown 
                          remarkPlugins={MATH_REMARK_PLUGINS}
                          rehypePlugins={MATH_REHYPE_PLUGINS}
                          components={{
                            pre: ({ children }) => {
                              return (
                                <div className="my-3 rounded-xl overflow-hidden border border-white/10 bg-[#09090b]">
                                  <div className="p-4 overflow-x-auto custom-scrollbar font-normal">
                                    {children}
                                  </div>
                                </div>
                              );
                            },
                            code: ({ className, children }) => <MarkdownCode className={className} size="compact">{children}</MarkdownCode>,
                            p: ({...props}) => <p className="mb-1 last:mb-0 inline-block" {...props} />
                          }}
                        >
                          {normalizeCodeBlocks(`**Q${questionIndex + 1}.** ${selectedQuestion.description}`)}
                        </ReactMarkdown>
                        <ContentBlocksView blocks={selectedQuestion.contentBlocks} size="compact" />
                      </div>
                    </div>

                    {/* Marks Awarded Input */}
                    <div className="flex flex-col items-end gap-1.5 shrink-0">
                      <div className="flex items-center gap-2 bg-[#0d111a] px-3 py-1.5 rounded-xl border border-white/10">
                        <input
                          type="number"
                          step="0.5"
                          min="0"
                          max={selectedQuestion.marks}
                          value={selectedAnswer ? (marksByAnswer[selectedAnswer.id] ?? "") : ""}
                          onChange={(e) => selectedAnswer && setMarksByAnswer((prev) => ({ ...prev, [selectedAnswer.id]: e.target.value }))}
                          className="w-16 text-white py-1 text-sm font-bold text-center rounded-none border-0 border-b border-white/20 bg-transparent px-0 transition-colors placeholder:text-zinc-500 focus:border-orange-500 focus:outline-none focus:ring-0"
                        />
                        <span className="text-xs font-semibold text-gray-400 pr-1">/ {selectedQuestion.marks} Marks</span>
                      </div>
                      {selectedAnswer?.evaluatedBy && (
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${selectedAnswer.evaluatedBy === "teacher" ? "bg-[#18181b]merald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-orange-500/10 text-orange-400 border border-orange-500/30"}`}>
                          {selectedAnswer.evaluatedBy === "teacher" ? <User className="h-3 w-3" /> : <Bot className="h-3 w-3" />}
                          Graded by {selectedAnswer.evaluatedBy === "teacher" ? "you" : "AI"}
                        </span>
                      )}
                    </div>
                  </div>
                </CardHeader>

                {/* Answer Content */}
                <CardContent className="p-4 sm:p-5 flex-1 flex flex-col space-y-3 overflow-y-auto custom-scrollbar min-h-0">
                  {isDescriptive ? (
                    <div className="flex-1 flex flex-col space-y-2 min-h-0 h-full">
                      <div className="text-xs text-gray-400 font-semibold uppercase tracking-wider">Student's Answer:</div>
                      <div className="flex-1 p-5 sm:p-6 rounded-2xl bg-[#0d111a] border border-white/10 text-gray-100 whitespace-pre-wrap font-mono text-base leading-relaxed overflow-y-auto custom-scrollbar shadow-inner min-h-[350px]">
                        {selectedAnswer?.textAnswer || <span className="text-gray-500 italic">No answer provided.</span>}
                      </div>

                      {/* Two Small Feedback Buttons */}
                      <div className="flex flex-wrap items-center gap-3 pt-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className={`text-xs border-white/10 h-8 px-3 rounded-lg flex items-center gap-1.5 transition-all ${
                            showQuestionFeedback || feedbackByAnswer[selectedAnswer?.id]
                              ? "bg-orange-500/20 text-orange-300 border-orange-500/30"
                              : "bg-white/5 text-gray-300 hover:text-white hover:bg-white/10"
                          }`}
                          onClick={() => setShowQuestionFeedback(!showQuestionFeedback)}
                        >
                          <MessageSquare className="h-3.5 w-3.5" />
                          {showQuestionFeedback || feedbackByAnswer[selectedAnswer?.id] ? "Question Feedback" : "+ Question Feedback"}
                        </Button>

                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className={`text-xs border-white/10 h-8 px-3 rounded-lg flex items-center gap-1.5 transition-all ${
                            showOverallFeedback || overallFeedbackInput
                              ? "bg-orange-500/20 text-orange-300 border-indigo-500/40"
                              : "bg-white/5 text-gray-300 hover:text-white hover:bg-white/10"
                          }`}
                          onClick={() => setShowOverallFeedback(!showOverallFeedback)}
                        >
                          <MessageSquare className="h-3.5 w-3.5" />
                          {showOverallFeedback || overallFeedbackInput ? "Overall Feedback" : "+ Overall Feedback"}
                        </Button>
                      </div>

                      {/* Question Feedback Textarea */}
                      {(showQuestionFeedback || feedbackByAnswer[selectedAnswer?.id]) && (
                        <div className="space-y-1.5 pt-1 animate-in fade-in duration-200">
                          <div className="text-xs text-orange-400 font-semibold uppercase tracking-wider flex justify-between">
                            <span>Question Feedback:</span>
                            <button type="button" onClick={() => setShowQuestionFeedback(false)} className="text-[11px] text-gray-500 hover:text-gray-300 lowercase font-normal">Close</button>
                          </div>
                          <textarea
                            value={selectedAnswer ? (feedbackByAnswer[selectedAnswer.id] ?? "") : ""}
                            onChange={(e) => selectedAnswer && setFeedbackByAnswer((prev) => ({ ...prev, [selectedAnswer.id]: e.target.value }))}
                            rows={2}
                            placeholder="Feedback for this question answer..."
                            className="w-full bg-[#0d111a] text-gray-100 border border-white/10 rounded-xl px-4 py-2.5 placeholder:text-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-all text-sm resize-none font-sans"
                          />
                        </div>
                      )}

                      {/* Overall Feedback Textarea */}
                      {(showOverallFeedback || overallFeedbackInput) && (
                        <div className="space-y-1.5 pt-1 animate-in fade-in duration-200">
                          <div className="text-xs text-orange-400 font-semibold uppercase tracking-wider flex justify-between">
                            <span>Overall Exam Feedback:</span>
                            <button type="button" onClick={() => setShowOverallFeedback(false)} className="text-[11px] text-gray-500 hover:text-gray-300 lowercase font-normal">Close</button>
                          </div>
                          <textarea
                            value={overallFeedbackInput}
                            onChange={(e) => setOverallFeedbackInput(e.target.value)}
                            rows={2}
                            placeholder="Overall comments for the student..."
                            className="w-full bg-[#0d111a] text-gray-100 border border-white/10 rounded-xl px-4 py-2.5 placeholder:text-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-all text-sm resize-none font-sans"
                          />
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {selectedQuestion.options?.map((opt: any) => {
                        const isSelected = selectedAnswer?.options?.includes(opt.id);
                        const isActualCorrect = opt.isCorrect;
                        
                        let optBg = "bg-black/20 border-white/5";
                        let icon = null;
                        
                        if (isSelected && isActualCorrect) {
                          optBg = "bg-[#18181b]merald-500/10 border-emerald-500/30 ring-1 ring-emerald-500/30";
                          icon = <Check className="h-5 w-5 text-emerald-400" />;
                        } else if (isSelected && !isActualCorrect) {
                          optBg = "bg-red-500/10 border-red-500/30 ring-1 ring-red-500/30";
                          icon = <X className="h-5 w-5 text-red-400" />;
                        } else if (!isSelected && isActualCorrect) {
                          optBg = "bg-[#18181b]merald-500/5 border-emerald-500/30 border-dashed";
                          icon = <Check className="h-5 w-5 text-emerald-400 opacity-50" />;
                        }

                        return (
                          <div key={opt.id} className={`p-4 rounded-xl border flex items-center justify-between ${optBg} transition-colors`}>
                            <div className="text-gray-200"><OptionValue value={opt.value} isCode={opt.isCode} size="compact" /></div>
                            {icon}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Actions Bar */}
                  <div className="flex items-center justify-between pt-4 border-t border-white/5 mt-auto">
                    <p className="text-[11px] text-gray-500 hidden sm:block">
                      Saving locks manual grades from AI overwrites.
                    </p>
                    <div className="flex items-center gap-2 ml-auto">
                      <Button
                        variant="outline"
                        className="bg-transparent border-white/10 text-white hover:bg-white/5 text-xs h-9 px-3"
                        onClick={handleEvaluateWithAi}
                        disabled={evaluatingAi || savingGrade}
                      >
                        <Bot className="mr-1.5 h-3.5 w-3.5 text-orange-400" />
                        {evaluatingAi ? "Evaluating..." : "Evaluate with AI"}
                      </Button>
                      <Button
                        className="bg-[#18181b]merald-600 hover:bg-[#18181b]merald-700 text-white text-xs font-semibold h-9 px-5 shadow-lg shadow-emerald-900/30"
                        onClick={handleSaveGrade}
                        disabled={savingGrade || evaluatingAi}
                      >
                        {savingGrade ? "Saving..." : "Save Grade"}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* RIGHT SIDE */}
          {isSidebarOpen && renderNavigationSidebar("hidden md:flex md:col-span-1 flex-col gap-4 md:min-h-0 animate-in fade-in duration-200")}
        </div>
      </div>
    </div>
  );
}
