"use client";

import React, { useState, useEffect, useMemo } from "react";
import { AlertCircle, Eye, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getExamByIdService, getSectionsWithDetailsService } from "@/app/teacher/exams/exam.service";
import ReactMarkdown from "react-markdown";
import { normalizeCodeBlocks } from "@/lib/markdown";
import { MATH_REMARK_PLUGINS, MATH_REHYPE_PLUGINS } from "@/lib/markdownMath";
import { ContentBlocksView, OptionValue, type ContentBlock, MarkdownCode } from "@/components/QuestionContentBlocks";

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

export function TeacherExamPreviewModal({
  examId,
  onClose,
}: {
  examId: string;
  onClose: () => void;
}) {
  const [exam, setExam] = useState<any>(null);
  const [sections, setSections] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);

  // Simulated local answers state for interactive previewing
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [textAnswers, setTextAnswers] = useState<Record<string, string>>({});

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [examRes, secRes] = await Promise.all([
          getExamByIdService(examId),
          getSectionsWithDetailsService(examId),
        ]);
        setExam(examRes.data || examRes);
        setSections(secRes.data || secRes || []);
      } catch (err) {
        console.error("Failed to load exam preview", err);
      } finally {
        setLoading(false);
      }
    };
    if (examId) fetchData();
  }, [examId]);

  // Flatten sections into linear questions
  const flattenedQuestions = useMemo<FlattenedQuestion[]>(() => {
    let globalIndex = 0;
    const result: FlattenedQuestion[] = [];

    sections.forEach((section: any) => {
      if (section.questions) {
        section.questions.forEach((q: any) => {
          result.push({
            id: q._id || q.id,
            globalIndex,
            sectionTitle: section.title,
            description: q.description || q.question_text || "",
            marks: q.marks || 1,
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
  }, [sections]);

  const currentQuestion = flattenedQuestions[currentIndex];

  const handleOptionChange = (questionId: string, optionId: string) => {
    setAnswers((prev) => ({
      ...prev,
      [questionId]: [optionId],
    }));
  };

  const handleTextAnswerChange = (questionId: string, text: string) => {
    setTextAnswers((prev) => ({
      ...prev,
      [questionId]: text,
    }));
  };

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 bg-[#14151f] border-white/15 text-white placeholder:text-zinc-400 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/30/80 backdrop-blur-md flex items-center justify-center text-white">
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 border-2 border-orange-500 border-t-transparent rounded-full animate-spin"></div>
          <span>Loading Student View Preview...</span>
        </div>
      </div>
    );
  }

  if (flattenedQuestions.length === 0) {
    return (
      <div className="fixed inset-0 z-50 bg-[#14151f] border-white/15 text-white placeholder:text-zinc-400 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/30/80 backdrop-blur-md flex items-center justify-center p-4">
        <Card className="bg-[#0f0f11] border-white/10 p-5 sm:p-8 max-w-md w-full text-center space-y-4 text-white">
          <AlertCircle className="h-10 w-10 text-yellow-500 mx-auto" />
          <h3 className="text-xl font-bold">No Questions Found</h3>
          <p className="text-sm text-gray-400">
            This exam does not have any questions yet. Add questions in the builder first to preview.
          </p>
          <Button onClick={onClose} variant="outline" className="w-full bg-transparent border-white/10 text-white hover:bg-white/5">
            Close Preview
          </Button>
        </Card>
      </div>
    );
  }

  const selectedOptions = currentQuestion ? answers[currentQuestion.id] || [] : [];
  const textAnswer = currentQuestion ? textAnswers[currentQuestion.id] || "" : "";

  return (
    <div className="fixed inset-0 z-50 bg-[#050505] text-white flex flex-col overflow-hidden animate-in fade-in duration-200">
      {/* Top Banner */}
      <div className="bg-[#18181b]mber-500/10 border-b border-amber-500/20 px-6 py-2 flex items-center justify-between text-xs text-amber-300">
        <div className="flex items-center gap-2 font-semibold">
          <Eye className="h-4 w-4 text-amber-400" />
          <span>STUDENT VIEW PREVIEW — Interactive preview mode for teachers. No submissions will be saved.</span>
        </div>
        <button onClick={onClose} className="hover:text-white font-bold uppercase tracking-wider text-[11px] bg-[#18181b]mber-500/20 hover:bg-[#18181b]mber-500/30 px-3 py-1 rounded border border-amber-500/30 transition-colors">
          EXIT PREVIEW ✕
        </button>
      </div>

      {/* Student Exam Header */}
      <header className="shrink-0 bg-[#0f0f11] border-b border-white/5 px-6 py-4 flex items-center justify-between shadow-md relative">
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight">{exam?.title || "Exam Preview"}</h1>
        </div>

        {/* Timer in Center (Simulated) */}
        <div className="absolute left-1/2 -translate-x-1/2 flex flex-col items-center">
          <span className="text-[10px] font-bold text-gray-500 tracking-widest uppercase mb-1">Time Remaining</span>
          <div className="font-mono text-2xl font-bold tracking-wider text-gray-200">
            {exam?.duration ? `${String(exam.duration).padStart(2, '0')}:00` : "60:00"}
          </div>
        </div>

        <Button
          disabled
          className="bg-orange-600/50 text-white/80 font-semibold cursor-not-allowed opacity-80"
          title="Submit exam button (Simulated student view)"
        >
          Submit Exam
        </Button>
      </header>

      {/* Main Content Area */}
      <div className="flex flex-1 min-h-0">
        {/* Left Pane: Question Content */}
        <div className="flex-1 flex flex-col overflow-y-auto custom-scrollbar">
          {/* Question Section Title & Header */}
          <div className="px-8 py-6 pb-2 border-b border-white/5">
            <p className="text-orange-400 font-bold text-xs uppercase tracking-widest mb-1">
              {currentQuestion.sectionTitle}
            </p>
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-400 tracking-wide">
                QUESTION {currentIndex + 1} OF {flattenedQuestions.length}
              </h2>
              <span className="text-xs font-semibold text-gray-500 bg-white/5 px-2.5 py-1 rounded">
                {currentQuestion.marks} Marks
              </span>
            </div>
          </div>

          {/* Question Description & Inputs */}
          <div className="flex-1 px-8 py-8 space-y-8 max-w-4xl">
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
                    p: ({ ...props }) => <p className="mb-4 last:mb-0" {...props} />,
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

            {/* Answer Options or Text Box */}
            {currentQuestion.type !== "mcq" ? (
              <div className="space-y-4">
                <textarea
                  value={textAnswer}
                  onChange={(e) => handleTextAnswerChange(currentQuestion.id, e.target.value)}
                  placeholder="Type your descriptive answer here (preview mode)..."
                  className="w-full min-h-[300px] bg-[#14151f] text-white border border-white/15 rounded-2xl p-6 focus:outline-none focus:border-white/30 transition-all resize-y shadow-inner text-base font-mono leading-relaxed placeholder:text-zinc-500"
                />
              </div>
            ) : (
              <div className="space-y-4">
                {currentQuestion.options?.map((opt: any, idx: number) => {
                  const optId = opt.id || opt._id || String(idx);
                  const isSelected = selectedOptions.includes(optId);
                  const letter = String.fromCharCode(65 + idx);

                  return (
                    <label
                      key={optId}
                      className={`
                        relative flex items-center p-4 cursor-pointer rounded-xl border-2 transition-all duration-200 group
                        ${
                          isSelected
                            ? "bg-[#18181b]mber-500/10 border-amber-500/50 text-white"
                            : "bg-transparent border-white/10 text-gray-300 hover:border-white/30 hover:bg-white/5"
                        }
                      `}
                    >
                      <input
                        type="radio"
                        name={`question-${currentQuestion.id}`}
                        className="sr-only"
                        checked={isSelected}
                        onChange={() => handleOptionChange(currentQuestion.id, optId)}
                      />

                      <div
                        className={`
                          flex items-center justify-center w-8 h-8 rounded-md border mr-4 shrink-0 transition-colors font-bold text-sm
                          ${isSelected ? "border-amber-500 bg-[#18181b]mber-600 text-white" : "border-zinc-700 text-white/80 group-hover:border-white/40"}
                        `}
                      >
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
          <div className="shrink-0 p-6 px-8 border-t border-white/5 bg-[#0f0f11]/50 flex items-center justify-end">
            <div className="flex gap-4">
              <Button
                variant="outline"
                onClick={() => setCurrentIndex((prev) => Math.max(0, prev - 1))}
                disabled={currentIndex === 0}
                className="bg-transparent border-white/10 text-gray-300 hover:text-white hover:bg-white/10"
              >
                <ChevronLeft className="mr-2 h-4 w-4" /> Previous
              </Button>

              <Button
                onClick={() => setCurrentIndex((prev) => Math.min(flattenedQuestions.length - 1, prev + 1))}
                disabled={currentIndex === flattenedQuestions.length - 1}
                className="bg-orange-600 hover:bg-orange-700 text-white font-semibold"
              >
                Next Question <ChevronRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        {/* Right Pane: Question Navigator Sidebar */}
        <aside className="w-56 md:w-64 lg:w-80 border-l border-white/5 bg-[#0f0f11] shrink-0 flex flex-col">
          <div className="p-6 border-b border-white/5 flex items-center justify-between">
            <h3 className="text-lg font-bold text-white">Navigator</h3>
            <span className="text-xs font-semibold text-gray-400 bg-[#14151f] border-white/15 text-white placeholder:text-zinc-400 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/30/20 px-2 py-1 rounded">
              {Object.keys(answers).length + Object.keys(textAnswers).filter(k => textAnswers[k].trim() !== "").length} / {flattenedQuestions.length} Answered
            </span>
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
            <div className="grid grid-cols-5 gap-2">
              {flattenedQuestions.map((q) => {
                const idx = q.globalIndex;
                const isCurrent = idx === currentIndex;
                const isAnswered =
                  q.type === "mcq"
                    ? !!answers[q.id]?.length
                    : !!textAnswers[q.id]?.trim();

                let bgColor = "bg-transparent";
                let borderColor = "border-white/10";
                let textColor = "text-gray-400";

                if (isCurrent) {
                  borderColor = "border-orange-500 ring-2 ring-blue-500 ring-offset-2 ring-offset-[#0f0f11]";
                  textColor = "text-white";
                }

                if (isAnswered) {
                  bgColor = "bg-[#18181b]merald-600";
                  borderColor = isCurrent ? "border-emerald-400 ring-2 ring-emerald-500 ring-offset-2 ring-offset-[#0f0f11]" : "border-emerald-500";
                  textColor = "text-white";
                }

                return (
                  <button
                    key={q.id}
                    onClick={() => setCurrentIndex(idx)}
                    className={`
                      aspect-square rounded flex items-center justify-center text-sm font-semibold border transition-all
                      hover:border-gray-400
                      ${bgColor} ${borderColor} ${textColor}
                    `}
                  >
                    {idx + 1}
                  </button>
                );
              })}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
