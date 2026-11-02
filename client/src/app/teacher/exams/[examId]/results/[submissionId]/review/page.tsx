"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Check, X, Bot, User, MessageSquare, ChevronLeft, ChevronRight, ClipboardCheck } from "lucide-react";
import { getSubmissionByIdService, getExamForSubmissionService } from "@/app/student/student.service";
import { gradeExamSubmissionService, evaluateExamSubmissionWithAiService } from "@/app/teacher/exams/exam.service";
import { toast } from "sonner";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import { normalizeCodeBlocks } from "@/lib/markdown";
import { MATH_REMARK_PLUGINS, MATH_REHYPE_PLUGINS } from "@/lib/markdownMath";
import { ContentBlocksView, OptionValue, MarkdownCode } from "@/components/QuestionContentBlocks";

export default function SubmissionReviewPage() {
  const params = useParams();
  const submissionId = params.submissionId as string;
  const examId = params.examId as string;
  const router = useRouter();

  const [submission, setSubmission] = useState<any>(null);
  const [exam, setExam] = useState<any>(null);
  const [loading, setLoading] = useState(true);

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

  const findQuestionInSections = (sections: any[], questionId: string) => {
    for (const section of sections) {
      const question = section.questions?.find((q: any) => q.id === questionId);
      if (question) return { section, question };
    }
    return null;
  };

  useEffect(() => {
    if (!submissionId) return;

    const fetchResult = async () => {
      try {
        const [subRes, examRes] = await Promise.all([
          getSubmissionByIdService(submissionId),
          getExamForSubmissionService(submissionId),
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

        if (examData?.sections?.length > 0) {
          const requestedQuestionId = new URLSearchParams(window.location.search).get("q");
          const firstSection = examData.sections[0];
          const target = requestedQuestionId
            ? findQuestionInSections(examData.sections, requestedQuestionId)
            : null;

          const initialSection = target?.section ?? firstSection;
          const initialQuestion = target?.question ?? firstSection.questions?.[0];

          setSelectedSectionId(initialSection.id);
          if (initialQuestion) setSelectedQuestionId(initialQuestion.id);
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
      interval = setInterval(() => fetchResult(), 5000);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [submissionId, router, submission?.status]);

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

  const orderedQuestions = useMemo(() => {
    const list: { section: any; question: any }[] = [];
    (exam?.sections || []).forEach((section: any) => {
      (section.questions || []).forEach((question: any) => {
        list.push({ section, question });
      });
    });
    return list;
  }, [exam]);

  const currentIndex = orderedQuestions.findIndex((entry) => entry.question.id === selectedQuestionId);

  const goToQuestion = (questionId: string, sectionId?: string) => {
    const target = findQuestionInSections(exam?.sections || [], questionId);
    if (target) {
      setSelectedSectionId(target.section.id);
      setSelectedQuestionId(questionId);
    } else if (sectionId) {
      setSelectedSectionId(sectionId);
      const firstQ = exam?.sections?.find((s: any) => s.id === sectionId)?.questions?.[0];
      if (firstQ) setSelectedQuestionId(firstQ.id);
    }
    setShowQuestionFeedback(false);
  };

  const goToSection = (sectionId: string) => {
    setSelectedSectionId(sectionId);
    const firstQ = exam?.sections?.find((s: any) => s.id === sectionId)?.questions?.[0];
    if (firstQ) setSelectedQuestionId(firstQ.id);
    setShowQuestionFeedback(false);
  };

  const handlePrev = () => {
    if (currentIndex > 0) {
      const prev = orderedQuestions[currentIndex - 1];
      goToQuestion(prev.question.id);
    }
  };

  const handleNext = () => {
    if (currentIndex < orderedQuestions.length - 1) {
      const next = orderedQuestions[currentIndex + 1];
      goToQuestion(next.question.id);
    }
  };

  const handleSaveGrade = async () => {
    if (!submission) return;
    for (const a of submission.answers) {
      const val = marksByAnswer[a.id];
      if (val === undefined || val === "" || isNaN(parseFloat(val))) {
        toast.error("Enter marks for every question before saving");
        return;
      }
      const parsed = parseFloat(val);
      const question = findQuestionInSections(exam?.sections || [], a.questionId)?.question;
      if (parsed < 0 || (question && parsed > question.marks)) {
        toast.error(`Marks for question ${question?.description?.slice(0, 40)}... cannot exceed ${question?.marks}`);
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

  if (loading) return <div className="p-4 sm:p-6 md:p-10 text-white text-center">Loading submission...</div>;
  if (!submission || !exam) return <div className="p-4 sm:p-6 md:p-10 text-white text-center">Result not found.</div>;

  if (submission.status === "evaluating") {
    return (
      <div className="p-4 sm:p-6 md:p-10 h-full flex flex-col items-center justify-center">
        <div className="w-16 h-16 border-4 border-orange-500 border-t-transparent rounded-full animate-spin mb-6"></div>
        <h2 className="text-xl font-bold text-white tracking-wide">Evaluating...</h2>
      </div>
    );
  }

  const currentSection = exam.sections?.find((s: any) => s.id === selectedSectionId) || exam.sections?.[0];
  const selectedQuestion = currentSection?.questions?.find((q: any) => q.id === selectedQuestionId);
  const selectedAnswer = selectedQuestion ? submission.answers?.find((a: any) => a.questionId === selectedQuestion.id) : undefined;
  const isDescriptive = selectedQuestion?.type === "descriptive";
  const isCurrentSectionDescriptive = currentSection?.questions?.some((q: any) => q.type === "descriptive");

  const marksInputClass =
    "w-24 bg-[#0d111a] border border-white/10 text-white rounded-lg px-3 py-2 text-base font-bold text-right focus:outline-none focus:ring-1 focus:ring-blue-500";

  const questionBtnClass = (q: any) => {
    const ans = submission.answers?.find((a: any) => a.questionId === q.id);
    let base = "bg-gray-500/10 text-gray-400 border-gray-500/20 hover:bg-gray-500/20";
    if (ans) {
      if (q.type === "descriptive") {
        if (ans.marksAwarded >= q.marks) base = "bg-[#18181b]merald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-[#18181b]merald-500/20";
        else if (ans.marksAwarded > 0) base = "bg-yellow-500/10 text-yellow-400 border-yellow-500/20 hover:bg-yellow-500/20";
        else base = "bg-red-500/10 text-red-400 border-red-500/20 hover:bg-red-500/20";
      } else {
        base = ans.isCorrect === true
          ? "bg-[#18181b]merald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-[#18181b]merald-500/20"
          : "bg-red-500/10 text-red-400 border-red-500/20 hover:bg-red-500/20";
      }
    }
    if (selectedQuestionId === q.id) base += " ring-2 ring-blue-500 ring-offset-2 ring-offset-[#0f0f11]";
    return base;
  };

  const overviewUrl = `/teacher/exams/${examId}/results/${submissionId}`;

  return (
    <div className="p-4 sm:p-8 h-full flex-1 flex flex-col bg-[#050505] overflow-y-auto">
      <div className="w-full max-w-5xl mx-auto flex flex-col">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6 shrink-0">
          <div className="flex items-center gap-4 min-w-0">
            <Link href={overviewUrl} className="inline-flex items-center text-gray-400 hover:text-white transition-colors shrink-0">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Overview
            </Link>
            <h1 className="text-lg sm:text-xl font-bold text-white truncate hidden md:block" title={exam.title}>{exam.title}</h1>
          </div>
          <Button
            className="bg-[#18181b]merald-600 hover:bg-[#18181b]merald-700 text-white text-sm font-semibold h-10 px-5"
            onClick={handleSaveGrade}
            disabled={savingGrade || evaluatingAi}
          >
            <ClipboardCheck className="mr-1.5 h-4 w-4" />
            {savingGrade ? "Saving..." : "Save Grade"}
          </Button>
        </div>

        {/* Question Palette */}
        <Card className="bg-[#0f0f11] border-white/5 shadow-xl mb-6 shrink-0">
          <CardContent className="p-5">
            <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
              <div className="flex items-center gap-2">
                <CardTitle className="text-base text-white">Questions</CardTitle>
                {selectedQuestion && (
                  <span className="text-sm text-gray-400">
                    {currentIndex + 1} of {orderedQuestions.length}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="bg-transparent border-white/10 text-white hover:bg-white/5 h-8"
                  onClick={handlePrev}
                  disabled={currentIndex <= 0}
                >
                  <ChevronLeft className="h-4 w-4 mr-1" /> Prev
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="bg-transparent border-white/10 text-white hover:bg-white/5 h-8"
                  onClick={handleNext}
                  disabled={currentIndex >= orderedQuestions.length - 1}
                >
                  Next <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </div>

            {exam.sections?.length > 1 && (
              <div className="flex flex-wrap gap-2 mb-4">
                {exam.sections.map((section: any) => (
                  <button
                    key={section.id}
                    onClick={() => goToSection(section.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
                      selectedSectionId === section.id
                        ? "bg-orange-500/20 text-orange-400 border-orange-500/30"
                        : "text-gray-400 hover:bg-white/5 border-white/5"
                    }`}
                  >
                    {section.title}
                  </button>
                ))}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {currentSection?.questions?.map((q: any, idx: number) => (
                <button
                  key={q.id}
                  onClick={() => goToQuestion(q.id)}
                  className={`w-10 h-10 shrink-0 rounded-lg flex items-center justify-center font-bold text-sm border transition-all ${questionBtnClass(q)}`}
                >
                  {idx + 1}
                </button>
              ))}
            </div>

            <div className="mt-5 pt-4 border-t border-white/5 flex flex-wrap gap-x-6 gap-y-2 text-xs text-gray-400">
              {isCurrentSectionDescriptive ? (
                <>
                  <span className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-[#18181b]merald-500/20 border border-emerald-500/40"></span> Full marks</span>
                  <span className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-yellow-500/20 border border-yellow-500/40"></span> Partial marks</span>
                  <span className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-red-500/20 border border-red-500/40"></span> Zero marks</span>
                </>
              ) : (
                <>
                  <span className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-[#18181b]merald-500/20 border border-emerald-500/40"></span> Correct</span>
                  <span className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-red-500/20 border border-red-500/40"></span> Incorrect</span>
                </>
              )}
              <span className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-gray-500/20 border border-gray-500/40"></span> Skipped</span>
            </div>
          </CardContent>
        </Card>

        {/* Question & Answer */}
        {selectedQuestion && (
          <Card className="bg-[#0f0f11]/80 border-white/5 shadow-xl backdrop-blur-xl mb-6 shrink-0">
            <CardHeader className="border-b border-white/5 pb-4 bg-white/[0.02]">
              <div className="flex flex-wrap justify-between items-start gap-4">
                <div className="flex flex-col gap-3 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`px-2.5 py-1 rounded-md text-[10px] uppercase font-bold tracking-wider ${selectedQuestion.type === "mcq" ? "bg-orange-500/10 text-orange-400 border border-orange-500/30" : "bg-[#18181b]mber-500/10 text-amber-400 border border-amber-500/20"}`}>
                      {selectedQuestion.type === "mcq" ? "Multiple Choice" : "Descriptive"}
                    </span>
                    <span className="border border-white/10 bg-white/5 px-2.5 py-1 rounded-md text-gray-300 text-[10px] font-bold">Question {currentIndex + 1}</span>
                    {selectedAnswer?.evaluatedBy && (
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${selectedAnswer.evaluatedBy === "teacher" ? "bg-[#18181b]merald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-orange-500/10 text-orange-400 border border-orange-500/30"}`}>
                        {selectedAnswer.evaluatedBy === "teacher" ? <User className="h-3 w-3" /> : <Bot className="h-3 w-3" />}
                        Graded by {selectedAnswer.evaluatedBy === "teacher" ? "you" : "AI"}
                      </span>
                    )}
                  </div>
                  <CardTitle className="text-lg font-medium text-white leading-relaxed prose prose-invert max-w-none">
                    <ReactMarkdown
                      remarkPlugins={MATH_REMARK_PLUGINS}
                      rehypePlugins={MATH_REHYPE_PLUGINS}
                      components={{
                        pre: ({ children }: any) => {
                          return (
                            <div className="my-5 rounded-xl overflow-hidden border border-white/10 bg-[#09090b] shadow-2xl">
                              <div className="p-5 overflow-x-auto custom-scrollbar font-normal">
                                {children}
                              </div>
                            </div>
                          );
                        },
                        code: ({ className, children }: any) => <MarkdownCode className={className} size="compact">{children}</MarkdownCode>,
                        p: ({ ...props }: any) => <p className="mb-2 last:mb-0 inline-block" {...props} />,
                      }}
                    >
                      {normalizeCodeBlocks(`**Q${currentIndex + 1}.** ${selectedQuestion.description}`)}
                    </ReactMarkdown>
                  </CardTitle>
                  <ContentBlocksView blocks={selectedQuestion.contentBlocks} size="compact" />
                </div>
                <div className="flex flex-col items-end gap-2 shrink-0">
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      max={selectedQuestion.marks}
                      value={selectedAnswer ? (marksByAnswer[selectedAnswer.id] ?? "") : ""}
                      onChange={(e) => selectedAnswer && setMarksByAnswer((prev) => ({ ...prev, [selectedAnswer.id]: e.target.value }))}
                      className={marksInputClass}
                    />
                    <span className="text-sm text-gray-400">/ {selectedQuestion.marks} Marks</span>
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-6">
              {isDescriptive ? (
                <div className="space-y-5">
                  <div>
                    <div className="text-xs text-gray-400 mb-2 font-semibold uppercase tracking-wider">Student&apos;s Answer:</div>
                    <div className="p-6 rounded-2xl bg-[#0d111a] border border-white/10 text-gray-100 whitespace-pre-wrap font-mono text-base leading-relaxed min-h-[400px] max-h-[650px] overflow-y-auto custom-scrollbar shadow-inner">
                      {selectedAnswer?.textAnswer || <span className="text-gray-500 italic">No answer provided.</span>}
                    </div>
                  </div>

                  <div className="pt-2">
                    {!showQuestionFeedback && !feedbackByAnswer[selectedAnswer?.id] ? (
                      <Button
                        type="button"
                        variant="ghost"
                        className="w-full border border-dashed border-orange-500/30 text-orange-400 hover:text-orange-300 hover:bg-orange-500/10 hover:border-orange-500/70 text-sm h-11 font-medium flex items-center justify-center gap-2"
                        onClick={() => setShowQuestionFeedback(true)}
                      >
                        <MessageSquare className="h-4 w-4" /> Add Question Feedback
                      </Button>
                    ) : (
                      <div className="space-y-2 animate-in fade-in duration-200">
                        <div className="flex items-center justify-between text-xs text-gray-400 font-semibold uppercase tracking-wider">
                          <span>Feedback for this answer:</span>
                          <button
                            type="button"
                            onClick={() => setShowQuestionFeedback(false)}
                            className="text-[11px] text-gray-500 hover:text-gray-300 font-normal lowercase"
                          >
                            hide
                          </button>
                        </div>
                        <textarea
                          value={selectedAnswer ? (feedbackByAnswer[selectedAnswer.id] ?? "") : ""}
                          onChange={(e) => selectedAnswer && setFeedbackByAnswer((prev) => ({ ...prev, [selectedAnswer.id]: e.target.value }))}
                          rows={5}
                          placeholder="Write feedback for this answer..."
                          className="w-full bg-[#0d111a] text-gray-100 border border-white/10 rounded-xl px-4 py-3 placeholder:text-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-all text-sm resize-y font-sans min-h-[120px]"
                        />
                      </div>
                    )}
                  </div>
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
            </CardContent>
          </Card>
        )}

        {/* Overall Feedback */}
        <Card className="bg-[#0f0f11] border-white/5 shadow-xl mb-6 shrink-0">
          <CardHeader className="pb-3 border-b border-white/5">
            <CardTitle className="text-base text-white flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-orange-400" />
              Overall Feedback
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            {showOverallFeedback || overallFeedbackInput ? (
              <div className="space-y-2 animate-in fade-in duration-200">
                <textarea
                  value={overallFeedbackInput}
                  onChange={(e) => setOverallFeedbackInput(e.target.value)}
                  rows={6}
                  placeholder="Write overall comments for the student..."
                  className="w-full bg-[#0d111a] text-gray-100 border border-white/10 rounded-xl px-4 py-3 placeholder:text-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-all text-sm resize-y font-sans min-h-[140px]"
                />
                <div className="flex items-center justify-end">
                  <button
                    type="button"
                    onClick={() => setShowOverallFeedback(false)}
                    className="text-[11px] text-gray-500 hover:text-gray-300 font-normal"
                  >
                    hide
                  </button>
                </div>
              </div>
            ) : (
              <Button
                type="button"
                variant="ghost"
                className="w-full border border-dashed border-orange-500/30 text-orange-400 hover:text-orange-300 hover:bg-orange-500/10 hover:border-orange-500/70 text-sm h-11 font-medium flex items-center justify-center gap-2"
                onClick={() => setShowOverallFeedback(true)}
              >
                <MessageSquare className="h-4 w-4" /> Add Overall Feedback
              </Button>
            )}
          </CardContent>
        </Card>

        {/* Actions */}
        <Card className="bg-[#0f0f11] border-white/5 shadow-xl shrink-0">
          <CardContent className="p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  className="bg-transparent border-white/10 text-white hover:bg-white/5 h-10"
                  onClick={handlePrev}
                  disabled={currentIndex <= 0}
                >
                  <ChevronLeft className="mr-1 h-4 w-4" /> Previous
                </Button>
                <Button
                  variant="outline"
                  className="bg-transparent border-white/10 text-white hover:bg-white/5 h-10"
                  onClick={handleNext}
                  disabled={currentIndex >= orderedQuestions.length - 1}
                >
                  Next <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  variant="outline"
                  className="bg-transparent border-white/10 text-white hover:bg-white/5 text-xs h-10"
                  onClick={handleEvaluateWithAi}
                  disabled={evaluatingAi || savingGrade}
                  title="Re-runs AI evaluation for any descriptive answer you haven't manually graded yet"
                >
                  <Bot className="mr-1.5 h-3.5 w-3.5" />
                  {evaluatingAi ? "Evaluating..." : "Evaluate with AI"}
                </Button>
                <Button
                  className="bg-[#18181b]merald-600 hover:bg-[#18181b]merald-700 text-white text-sm font-semibold h-10 px-5"
                  onClick={handleSaveGrade}
                  disabled={savingGrade || evaluatingAi}
                >
                  {savingGrade ? "Saving..." : "Save Grade"}
                </Button>
              </div>
            </div>
            <p className="text-[11px] text-gray-500 mt-3">
              Saving a grade marks those answers as graded by you — AI evaluation will never overwrite them afterwards.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
