"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import { ArrowLeft, ArrowUp, Plus, Check, X, CheckCircle2, Circle, Zap, Sparkles, ChevronDown, ChevronUp, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";
import { normalizeCodeBlocks } from "@/lib/markdown";
import { ContentBlocksView, OptionValue, MarkdownCode } from "@/components/QuestionContentBlocks";
import { MATH_REMARK_PLUGINS, MATH_REHYPE_PLUGINS } from "@/lib/markdownMath";

import { TopicsPanel } from "./TopicsPanel";
import { ModePicker, type CreationMode } from "./workspace";
import { BlueprintTreeViewer } from "@/components/BlueprintTreeViewer";
import BlueprintRefinementChat from "@/components/BlueprintRefinementChat";
import QuestionReviewChat from "@/components/QuestionReviewChat";
import { createSectionService, getSectionsWithDetailsService, updateSectionService, deleteSectionService, createQuestionService, updateQuestionService, deleteQuestionService, saveGeneratedExamService, getExamByIdService } from "@/app/teacher/exams/exam.service";
import { useExamBuilderStore } from "@/store/useExamBuilderStore";
import {
  triggerBlueprintGeneration,
  getBlueprintStatus,
  triggerQuestionGeneration,
  getQuestionsStatus,
  ExamBlueprintSection,
  GeneratedExam,
  ExamInput,
  Difficulty,
  startExamIntentConversation,
  continueExamIntentConversation,
  skipExamIntentQuestion,
  skipAllExamIntentQuestions,
  rebalanceBlueprint,
  getExamIntentConversation,
} from "@/services/generationAgents.service";
import { useRealtimeVoiceAgent } from "@/hooks/useRealtimeVoiceAgent";
import { useEntitlements } from "@/hooks/useEntitlements";
import { buildSourceLookup, type BookToc } from "@/services/books.service";
import { CopyButton } from "@/components/CopyButton";
import { MicButton, ListeningIndicator } from "@/components/MicButton";
import { useSpeechToText } from "@/hooks/useSpeechToText";
import {
  buildExamInputFromConfig,
  sectionsToLegacyTree,
  legacyTreeToSections,
  computeTotalQuestions,
  computeGeneratedCount,
  generatedExamToSaveShape,
  LegacyBlueprintTree,
  SectionBlockMapEntry,
} from "./blueprintAdapter";

export type EditorConfig = {
  isOpen: boolean;
  sectionId: string | null;
  question: any | null; // null if adding new, object if editing existing
};

export function QuestionBuilder({
  examId,
  sectionsState,
  showReviewAgent = true,
  onPickMode,
}: {
  examId: string;
  // Lets a parent own the section list, e.g. to drive a review agent rendered outside this component.
  sectionsState?: { sections: any[]; setSections: (sections: any[]) => void };
  showReviewAgent?: boolean;
  // When given, an exam with no questions offers every way of building them (AI, past papers, a book) and calls this
  // with the one picked, instead of showing a single AI button.
  onPickMode?: (mode: CreationMode) => void;
}) {
  const [internalSections, setInternalSections] = useState<any[]>([]);
  const sections = sectionsState?.sections ?? internalSections;
  const setSections = sectionsState?.setSections ?? setInternalSections;
  const [loading, setLoading] = useState(true);
  const { isAiMode, setIsAiMode, isAddingSection, setIsAddingSection } = useExamBuilderStore();
  const [examDetail, setExamDetail] = useState<any>(null);
  const [aiTargetSectionId, setAiTargetSectionId] = useState<string | null>(null);
  const [showQuestionReview, setShowQuestionReview] = useState(false);

  useEffect(() => {
    if (!examId || examId === "new") {
      setLoading(false);
      return;
    }
    const fetchExam = async () => {
      try {
        const res = await getExamByIdService(examId);
        setExamDetail(res.data || res);
      } catch (error) {
        console.error("Failed to load exam details", error);
      } finally {
        setLoading(false);
      }
    };
    fetchExam();
  }, [examId]);
  const [newSectionTitle, setNewSectionTitle] = useState("");

  const [editorConfig, setEditorConfig] = useState<EditorConfig>({
    isOpen: false,
    sectionId: null,
    question: null
  });

  const [sidebarWidth, setSidebarWidth] = useState(400);
  const [isDraggingSidebar, setIsDraggingSidebar] = useState(false);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingSidebar) return;
      const newWidth = window.innerWidth - e.clientX;
      setSidebarWidth(Math.max(350, Math.min(800, newWidth)));
    };
    const handleMouseUp = () => setIsDraggingSidebar(false);

    if (isDraggingSidebar) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    } else {
      document.body.style.cursor = "default";
      document.body.style.userSelect = "auto";
    }

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "default";
      document.body.style.userSelect = "auto";
    };
  }, [isDraggingSidebar]);

  const fetchSections = async () => {
    try {
      const data = await getSectionsWithDetailsService(examId);
      setSections(data.data || []);
    } catch {
      toast.error("Failed to load sections");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSections();
  }, [examId]);

  const handleSaveNewSection = async () => {
    if (!newSectionTitle.trim()) {
      toast.error("Section title is required");
      return;
    }
    try {
      await createSectionService({ examId, title: newSectionTitle });
      fetchSections();
      setNewSectionTitle("");
      setIsAddingSection(false);
      toast.success("Section added");
    } catch (err: any) {
      toast.error(err.response?.data?.message || err.message || "Failed to add section");
    }
  };

  if (loading) return <div className="text-white text-center py-10">Loading builder...</div>;

  return (
    <div className="space-y-6 relative h-full">
      {isAiMode ? (
        <AiExamGeneratorForm
          examId={examId}
          examDetail={examDetail}
          existingSectionsCount={sections.length}
          existingSections={sections}
          initialTargetSectionId={aiTargetSectionId}
          onBack={() => {
            setAiTargetSectionId(null);
            setIsAiMode(false);
          }}
          onSuccess={() => {
            setAiTargetSectionId(null);
            setIsAiMode(false);
            fetchSections();
          }}
        />
      ) : isAddingSection ? (
        <Card className="bg-[#0f0f11] border-orange-500/50 shadow-xl overflow-hidden animate-in fade-in slide-in-from-top-4">
          <div className="p-4 flex items-center gap-4">
            <Input
              autoFocus
              placeholder="Enter section title..."
              value={newSectionTitle}
              onChange={e => setNewSectionTitle(e.target.value)}
              className="text-white placeholder:text-zinc-400 h-10 flex-1 max-w-md"
              onKeyDown={(e) => e.key === "Enter" && handleSaveNewSection()}
            />
            <Button onClick={handleSaveNewSection} className="bg-green-600 hover:bg-green-700 text-white">Save Section</Button>
            <Button variant="ghost" onClick={() => setIsAddingSection(false)} className="text-gray-400 hover:text-white">Cancel</Button>
          </div>
        </Card>
      ) : sections.length === 0 && onPickMode ? (
        <div className="mx-auto w-full max-w-2xl py-8">
          <ModePicker selected={null} onSelect={onPickMode} onManual={() => setIsAddingSection(true)} />
        </div>
      ) : sections.length === 0 ? (
        <div className="max-w-2xl mx-auto py-12 space-y-6">
          <h4 className="text-center text-lg font-bold text-white tracking-wide">How would you like to add questions?</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card className="bg-[#0f0f11] border-purple-500/20 hover:border-purple-500/50 hover:bg-[#151a28] cursor-pointer transition-all duration-300 p-6 flex flex-col items-center text-center space-y-4" onClick={() => setIsAiMode(true)}>
              <div className="h-12 w-12 rounded-xl bg-purple-500/10 text-purple-400 flex items-center justify-center border border-purple-500/20">
                <Sparkles className="h-6 w-6 animate-pulse" />
              </div>
              <div>
                <h5 className="font-bold text-white text-base">Create with AI</h5>
                <p className="text-xs text-gray-400 mt-1.5 leading-relaxed">
                  Instantly generate all exam sections, questions, multiple choices, and options using AI.
                </p>
              </div>
            </Card>

            <Card className="bg-[#0f0f11] border-white/5 hover:border-orange-500/30 hover:bg-[#151a28] cursor-pointer transition-all duration-300 p-6 flex flex-col items-center text-center space-y-4" onClick={() => setIsAddingSection(true)}>
              <div className="h-12 w-12 rounded-xl bg-orange-500/10 text-orange-400 flex items-center justify-center border border-orange-500/30">
                <Plus className="h-6 w-6" />
              </div>
              <div>
                <h5 className="font-bold text-white text-base">Build Manually</h5>
                <p className="text-xs text-gray-400 mt-1.5 leading-relaxed">
                  Create your own custom sections, write questions, and set options manually from scratch.
                </p>
              </div>
            </Card>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-6 pb-20 relative">

          {/* Main List Area */}
          <div className="flex-1 space-y-8 transition-all duration-300 min-w-0">
            {sections.map((section, idx) => (
              <SectionItem
                key={section._id || section.id}
                examId={examId}
                canEditTopics={examDetail?.status !== "PUBLISHED"}
                section={section}
                index={idx}
                refresh={fetchSections}
                onOpenEditor={(q) => setEditorConfig({ isOpen: true, sectionId: section._id || section.id, question: q })}
                onOpenAiForSection={(secId) => {
                  setAiTargetSectionId(secId);
                  setIsAiMode(true);
                }}
              />
            ))}
          </div>

          {/* Resizable Splitter */}
          {editorConfig.isOpen && editorConfig.sectionId && (
            <div
              className="hidden md:flex w-4 bg-transparent hover:bg-orange-500/20 active:bg-orange-500/40 cursor-col-resize shrink-0 transition-colors items-center justify-center group"
              onMouseDown={() => setIsDraggingSidebar(true)}
            >
              <div className="w-0.5 h-full min-h-[500px] bg-white/10 group-hover:bg-blue-400 rounded-full transition-colors" />
            </div>
          )}

          {/* Right Sidebar Editor */}
          {editorConfig.isOpen && editorConfig.sectionId && (
            // Phones: a full-screen panel over the list (there is no room beside it). From md up: the resizable side panel.
            <div
              className="fixed inset-0 z-50 h-dvh w-full md:static md:z-auto md:h-[calc(100vh-250px)] md:w-[var(--editor-w)] md:shrink-0 md:sticky md:top-0 bg-[#151a28] md:border border-orange-500/30 md:rounded-xl shadow-[0_0_40px_rgba(147,51,234,0.15)] flex flex-col animate-in slide-in-from-right-8 overflow-hidden"
              style={{ "--editor-w": `${sidebarWidth}px` } as React.CSSProperties}
            >
              <SidebarQuestionEditor
                config={editorConfig}
                onClose={() => setEditorConfig({ isOpen: false, sectionId: null, question: null })}
                onSaveAndAnother={() => setEditorConfig({ isOpen: true, sectionId: editorConfig.sectionId, question: null })}
                refresh={fetchSections}
                examDetail={examDetail}
              />
            </div>
          )}

        </div>
      )}

      {/* Question Review Agent — voice-based editing of the real, saved
          questions, available as a floating panel on top of the normal
          exam view rather than a separate page. */}
      {showReviewAgent && !isAiMode && !isAddingSection && sections.length > 0 && (
        <>
          {showQuestionReview ? (
            <div className="fixed bottom-3 right-3 sm:bottom-6 sm:right-6 z-50 w-[min(380px,calc(100vw-1.5rem))] h-[min(560px,calc(100dvh-1.5rem))] shadow-2xl">
              <QuestionReviewChat
                examId={examId}
                onSectionsChange={setSections}
                onDone={() => setShowQuestionReview(false)}
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowQuestionReview(false)}
                className="absolute -top-3 -right-3 h-7 w-7 p-0 rounded-full bg-zinc-800 border border-white/10 text-gray-300 hover:text-white"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          ) : (
            <Button
              onClick={() => setShowQuestionReview(true)}
              className="fixed bottom-6 right-6 z-50 h-12 px-5 rounded-full bg-orange-600 hover:bg-orange-700 text-white font-semibold shadow-2xl"
            >
              <Sparkles className="h-4 w-4 mr-2" /> Question Review Agent
            </Button>
          )}
        </>
      )}

    </div>
  );
}

// -------------------------------------------------------------
// SECTION COMPONENT
// -------------------------------------------------------------
function SectionItem({ examId, canEditTopics, section, index, refresh, onOpenEditor, onOpenAiForSection }: { examId: string, canEditTopics: boolean, section: any, index: number, refresh: () => void, onOpenEditor: (q: any) => void, onOpenAiForSection?: (secId: string) => void }) {
  const [isEditing, setIsEditing] = useState(false);
  const [isExpanded, setIsExpanded] = useState(true);
  const [title, setTitle] = useState(section.title || "");
  const sectionId = section._id || section.id;

  const handleUpdate = async () => {
    try {
      await updateSectionService(sectionId, { title });
      setIsEditing(false);
      refresh();
      toast.success("Section updated");
    } catch (err: any) {
      toast.error(err.response?.data?.message || err.message || "Failed to update section");
    }
  };

  const handleDelete = async () => {
    if (!confirm("Are you sure you want to delete this section? All questions inside will be lost.")) return;
    try {
      await deleteSectionService(sectionId);
      refresh();
      toast.success("Section deleted");
    } catch (err: any) {
      toast.error(err.response?.data?.message || err.message || "Failed to delete section");
    }
  };

  // A section holds one kind of question. Quick Add follows it: the type of the questions already in the section, or,
  // while it is empty, the type its block was planned with. MCQ is only the last fallback.
  const sectionQuestionType: "mcq" | "descriptive" = (() => {
    const existing = (section.questions || [])[0]?.type;
    if (existing === "mcq" || existing === "descriptive") return existing;
    const planned = (section.blocks || [])[0]?.questionType;
    return planned === "descriptive" ? "descriptive" : "mcq";
  })();

  const handleQuickAdd = async (count: number) => {
    try {
      const promises = [];
      for (let i = 0; i < count; i++) {
        promises.push(createQuestionService(
          sectionQuestionType === "descriptive"
            ? {
                sectionId,
                type: "descriptive",
                description: "New Question - Click edit to modify",
                marks: 1,
              }
            : {
                sectionId,
                type: "mcq",
                description: "New Question - Click edit to modify",
                marks: 1,
                options: [
                  { value: "Option A", isCorrect: true },
                  { value: "Option B", isCorrect: false },
                  { value: "Option C", isCorrect: false },
                  { value: "Option D", isCorrect: false }
                ]
              }
        ));
      }
      await Promise.all(promises);
      refresh();
      toast.success(`${count} question${count > 1 ? 's' : ''} added`);
    } catch (err: any) {
      toast.error(err.response?.data?.message || err.message || "Failed to quick add questions");
    }
  };

  return (
    <Card className="bg-[#0f0f11]/80 border-white/10 shadow-xl overflow-hidden transition-all duration-300">
      <div className="bg-[#18181b] px-3 sm:px-6 py-3 sm:py-4 flex items-center justify-between gap-2 border-b border-white/5">
        <div className="flex-1 flex items-center gap-4">
          <Button 
            variant="ghost" 
            size="icon" 
            className="h-8 w-8 -ml-2 text-gray-400 hover:text-white" 
            onClick={() => setIsExpanded(!isExpanded)}
          >
            {isExpanded ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
          </Button>
          <span className="text-orange-400 font-bold bg-orange-500/10 px-2.5 py-1 rounded">S{index + 1}</span>
          {isEditing ? (
            <div className="flex items-center gap-2 w-full max-w-sm">
              <Input autoFocus value={title} onChange={e => setTitle(e.target.value)} className="text-white placeholder:text-zinc-400 h-9" onKeyDown={(e) => e.key === "Enter" && handleUpdate()} />
              <Button size="icon" variant="ghost" onClick={handleUpdate} className="text-green-400 hover:text-green-300 hover:bg-green-400/10 h-9 w-9"><Check className="h-4 w-4" /></Button>
              <Button size="icon" variant="ghost" onClick={() => setIsEditing(false)} className="text-red-400 hover:text-red-300 hover:bg-red-400/10 h-9 w-9"><X className="h-4 w-4" /></Button>
            </div>
          ) : (
            <h4 className="text-lg font-bold text-white tracking-wide">{section.title}</h4>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!isEditing && (
            <Button size="sm" variant="outline" onClick={() => setIsEditing(true)} className="bg-transparent border-white/15 text-white hover:bg-white/10 h-8 px-3 text-xs font-semibold">
              Edit
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={handleDelete} className="bg-transparent border-red-500/20 text-red-400 hover:bg-red-500/10 h-8 px-3 text-xs font-semibold">
            Delete
          </Button>
        </div>
      </div>

      {isExpanded && (
        <CardContent className="p-2 sm:p-6 space-y-3 sm:space-y-4 animate-in slide-in-from-top-2 fade-in duration-200">
          <TopicsPanel examId={examId} section={section} canEdit={canEditTopics} refresh={refresh} />
          {(section.questions || []).map((q: any, qIdx: number) => (
            <QuestionItem key={q._id || q.id} question={q} index={qIdx} refresh={refresh} onEdit={() => onOpenEditor(q)} />
          ))}

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full">
            <Button onClick={() => onOpenEditor(null)} variant="outline" className="flex-1 bg-transparent border-dashed border-white/20 text-gray-400 hover:text-white hover:bg-white/5 py-5 sm:py-6 text-xs sm:text-sm">
              <Plus className="h-4 w-4 mr-2" /> Custom Question
            </Button>

            <Button
              onClick={() => onOpenAiForSection && onOpenAiForSection(section._id || section.id)}
              variant="outline"
              className="flex-1 bg-purple-500/10 border-dashed border-purple-500/30 text-purple-300 hover:text-white hover:bg-purple-500/20 py-5 sm:py-6 font-bold text-xs sm:text-sm"
            >
              <Sparkles className="h-4 w-4 mr-2 text-purple-400" /> AI Add Questions
            </Button>

            <div className="flex-1 flex items-center bg-orange-500/10 border border-dashed border-orange-500/30 rounded-md overflow-hidden min-h-[44px]">
              <div className="px-2.5 py-2.5 text-xs text-orange-400 font-bold flex items-center border-r border-orange-500/30 whitespace-nowrap shrink-0">
                <Zap className="h-3.5 w-3.5 mr-1" /> Quick Add
              </div>
              <button onClick={() => handleQuickAdd(1)} className="flex-1 py-2.5 text-xs sm:text-sm text-orange-300 hover:bg-orange-500/20 hover:text-white transition-colors border-r border-orange-500/30 font-bold">+1</button>
              <button onClick={() => handleQuickAdd(5)} className="flex-1 py-2.5 text-xs sm:text-sm text-orange-300 hover:bg-orange-500/20 hover:text-white transition-colors border-r border-orange-500/30 font-bold">+5</button>
              <button onClick={() => handleQuickAdd(10)} className="flex-1 py-2.5 text-xs sm:text-sm text-orange-300 hover:bg-orange-500/20 hover:text-white transition-colors font-bold">+10</button>
            </div>
          </div>
        </CardContent>
      )}
    </Card>
  );
}

// -------------------------------------------------------------
// QUESTION COMPONENT
// -------------------------------------------------------------
function QuestionItem({ question, index, refresh, onEdit }: { question: any, index: number, refresh: () => void, onEdit: () => void }) {
  const questionId = question._id || question.id;

  const handleDelete = async () => {
    if (!confirm("Delete this question?")) return;
    try {
      await deleteQuestionService(questionId);
      refresh();
      toast.success("Question deleted");
    } catch (err: any) {
      toast.error(err.response?.data?.message || err.message || "Failed to delete question");
    }
  };

  return (
    <div className="bg-[#18181b]/60 border border-white/5 rounded-xl sm:rounded-2xl p-3 sm:p-6 relative overflow-hidden shadow-sm hover:shadow-md hover:border-white/10 transition-all group">
      <div className="absolute top-0 left-0 bg-orange-500/10 text-orange-400 font-mono text-xs font-bold px-3 py-1.5 rounded-br-xl border-b border-r border-orange-500/30">
        Q{index + 1}
      </div>

      {/* Marks sits on the same row as Edit / Delete. */}
      <div className="absolute top-2.5 right-2.5 sm:top-4 sm:right-4 flex items-center gap-2">
        <span className="flex h-8 items-center whitespace-nowrap border border-white/10 bg-white/5 px-2.5 rounded-md text-gray-300 text-[10px] font-bold">Marks: {question.marks || 1}</span>
        <Button size="sm" variant="outline" className="bg-[#14151f] border-white/15 text-white hover:bg-white/10 h-8 px-3 text-xs font-semibold" onClick={onEdit}>
          Edit
        </Button>
        <Button size="sm" variant="outline" className="bg-transparent border-red-500/20 text-red-400 hover:bg-red-500/10 h-8 px-3 text-xs font-semibold" onClick={handleDelete}>
          Delete
        </Button>
      </div>

      <div className="pt-9">
        {/* No type badge: the type is obvious from whether the question has options. */}
        <div className="text-white text-[15px] leading-relaxed mb-4 sm:mb-6 font-medium prose prose-invert max-w-none">
          <ReactMarkdown 
            remarkPlugins={MATH_REMARK_PLUGINS}
            rehypePlugins={MATH_REHYPE_PLUGINS}
            components={{
                pre: ({ children }) => {
                  return (
                    <div className="my-5 rounded-xl overflow-hidden border border-white/10 bg-[#09090b] shadow-2xl">
                      <div className="p-5 overflow-x-auto custom-scrollbar font-normal">
                        {children}
                      </div>
                    </div>
                  );
                },
                code: ({ className, children }) => <MarkdownCode className={className} size="compact">{children}</MarkdownCode>,
                p: ({...props}) => <p className="mb-2 last:mb-0" {...props} />
              }}
          >
            {normalizeCodeBlocks(question.description || question.question || question.text || "No question text provided.")}
          </ReactMarkdown>
        </div>

        <div className="max-w-3xl -mt-3 mb-1 sm:mb-5">
          <ContentBlocksView blocks={question.contentBlocks} size="compact" />
        </div>

        {question.images && question.images.length > 0 && (
          <div className="mt-4 mb-6">
            <img src={question.images[0].url} alt="Question figure" className="max-h-64 object-contain rounded-lg border border-white/10 bg-[#14151f] border-white/15 text-white placeholder:text-zinc-400 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/30/50" />
          </div>
        )}

        {/* Display Read-Only Options */}
        {question.type === 'mcq' && question.options && question.options.length > 0 && (
          <div className="space-y-2.5 max-w-3xl">
            {question.options.map((opt: any) => (
              <div key={opt._id || opt.id} className={cn(
                "flex items-center p-3.5 rounded-xl border border-white/5 bg-[#0f0f11] text-[14px] transition-all duration-200 hover:bg-white/5 hover:border-white/10",
                opt.isCorrect ? "text-white" : "text-gray-400"
              )}>
                {opt.isCorrect
                  ? <span className="mr-3.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-green-500"><Check className="h-3 w-3 text-white" strokeWidth={3.5} /></span>
                  : <div className="mr-3.5 h-5 w-5 shrink-0 rounded-full border-2 border-gray-600" />}
                <span className="font-medium"><OptionValue value={opt.value} isCode={opt.isCode} size="compact" /></span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// RIGHT SIDEBAR QUESTION EDITOR
// -------------------------------------------------------------
function SidebarQuestionEditor({ config, onClose, onSaveAndAnother, refresh, examDetail }: { config: EditorConfig, onClose: () => void, onSaveAndAnother: () => void, refresh: () => void, examDetail: any }) {
  const isEditMode = !!config.question;
  const questionId = isEditMode ? (config.question._id || config.question.id) : null;

  const [type, setType] = useState<"mcq" | "descriptive">(config.question?.type || "mcq");
  const [description, setDescription] = useState(config.question?.description || "");
  const [marks, setMarks] = useState(config.question?.marks?.toString() || "1");
  const [options, setOptions] = useState<any[]>(
    isEditMode && config.question?.options?.length > 0
      ? config.question.options
      : [
        { value: "", isCorrect: true },
        { value: "", isCorrect: false },
        { value: "", isCorrect: false },
        { value: "", isCorrect: false }
      ]
  );

  const [isSaving, setIsSaving] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(config.question?.images?.[0]?.url || null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Sync state if config changes (e.g. Save & Another clicked)
  useEffect(() => {
    setType(config.question?.type || "mcq");
    setDescription(config.question?.description || "");
    setMarks(config.question?.marks?.toString() || "1");
    setOptions(
      config.question?.options?.length > 0
        ? config.question.options
        : [
          { value: "", isCorrect: true },
          { value: "", isCorrect: false },
          { value: "", isCorrect: false },
          { value: "", isCorrect: false }
        ]
    );
    setImageFile(null);
    setImagePreview(config.question?.images?.[0]?.url || null);
  }, [config, examDetail]);

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setImageFile(e.target.files[0]);
      setImagePreview(URL.createObjectURL(e.target.files[0]));
    }
  };

  const removeImage = () => {
    setImageFile(null);
    setImagePreview(null);
  };

  const handleInsertCodeBlock = () => {
    if (!textareaRef.current) return;
    const textarea = textareaRef.current;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    
    const selectedText = description.substring(start, end);
    const beforeText = description.substring(0, start);
    const afterText = description.substring(end);
    
    const codeBlock = `\n\`\`\`python\n${selectedText || 'console.log("Hello World");'}\n\`\`\`\n`;
    
    const newDescription = beforeText + codeBlock + afterText;
    setDescription(newDescription);
    
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + 11, start + 11 + (selectedText.length || 27));
    }, 0);
  };

  const handleSave = async (addAnother: boolean = false) => {
    if (description.trim().length < 10) {
      toast.error("Description must be at least 10 characters");
      return;
    }

    let payloadOptions = undefined;
    if (type === "mcq") {
      const validOptions = options.filter(o => o.value.trim() !== "");
      if (validOptions.length < 2) {
        toast.error("MCQ requires at least 2 non-empty options");
        return;
      }
      if (!validOptions.some(o => o.isCorrect)) {
        toast.error("Please mark at least one option as correct");
        return;
      }
      // Map options to strip temp IDs if any
      payloadOptions = validOptions.map(o => ({ value: o.value, isCorrect: o.isCorrect, ...(o.id || o._id ? { id: o.id || o._id } : {}) }));
    }

    setIsSaving(true);
    try {
      const formData = new FormData();
      if (!isEditMode) formData.append("sectionId", config.sectionId!);
      if (!isEditMode) formData.append("type", type);
      formData.append("description", description);
      formData.append("marks", marks);
      if (type === "mcq" && payloadOptions) {
        formData.append("options", JSON.stringify(payloadOptions));
      }
      if (imageFile) {
        formData.append("images", imageFile);
      }

      if (isEditMode) {
        await updateQuestionService(questionId, formData);
        toast.success("Question updated successfully");
      } else {
        await createQuestionService(formData);
        toast.success("Question created successfully");
      }

      refresh();

      if (addAnother) {
        onSaveAndAnother();
      } else {
        onClose();
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to save question");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 sm:px-6 py-4 sm:py-5 border-b border-white/5 flex items-center justify-between bg-[#18181b]">
        <h3 className="font-bold text-white text-lg">{isEditMode ? "Edit Question" : "New Question"}</h3>
        <Button size="icon" variant="ghost" onClick={onClose} className="text-gray-400 hover:text-white h-8 w-8">
          <X className="h-5 w-5" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5 sm:space-y-6 custom-scrollbar">
        {!isEditMode && (
          <div className="space-y-2">
            <label className="text-sm font-semibold text-gray-300">Question Type</label>
            <Select value={type} onValueChange={(val: any) => setType(val)}>
              <SelectTrigger className="w-full text-white h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-[#0f0f11] border-white/10 text-white">
                <SelectItem value="mcq">Multiple Choice</SelectItem>
                <SelectItem value="descriptive">Descriptive</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="space-y-2">
          <label className="text-sm font-semibold text-gray-300">Marks</label>
          <Input
            type="number"
            step="0.5"
            value={marks}
            onChange={e => setMarks(e.target.value)}
            className="w-full text-white h-11"
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-sm font-semibold text-gray-300">Question Description</label>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleInsertCodeBlock}
                className="h-7 text-xs bg-orange-500/10 border-orange-500/30 text-orange-400 hover:text-white hover:bg-orange-500/30 font-semibold"
              >
                Make Code Block
              </Button>
            </div>
          </div>
          <Textarea
            ref={textareaRef}
            placeholder="Enter question text here..."
            value={description}
            onChange={e => setDescription(e.target.value)}
            className="bg-[#14151f] border border-white/15 text-white placeholder:text-zinc-400 min-h-[140px] font-mono text-[13px]"
          />
          <p className="text-xs text-gray-500 text-right">{description.length} chars (min 10)</p>
        </div>

        {/* Image Upload Area */}
        <div className="space-y-2">
          <label className="text-sm font-semibold text-gray-300">Question Image (Optional)</label>
          {imagePreview ? (
            <div className="relative inline-block border border-white/10 rounded-lg overflow-hidden bg-[#14151f] border-white/15 text-white placeholder:text-zinc-400 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/30/50">
              <img src={imagePreview} alt="Question preview" className="max-h-48 object-contain" />
              <Button
                type="button"
                size="icon"
                variant="destructive"
                onClick={removeImage}
                className="absolute top-2 right-2 h-7 w-7 rounded-full opacity-80 hover:opacity-100"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <div className="flex items-center justify-center w-full">
              <label className="flex flex-col items-center justify-center w-full h-24 border-2 border-white/10 border-dashed rounded-lg cursor-pointer bg-[#050505] hover:bg-white/5 transition-colors">
                <div className="flex flex-col items-center justify-center pt-5 pb-6">
                  <svg className="w-6 h-6 mb-2 text-gray-500" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 20 16">
                    <path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 13h3a3 3 0 0 0 0-6h-.025A5.56 5.56 0 0 0 16 6.5 5.5 5.5 0 0 0 5.207 5.021C5.137 5.017 5.071 5 5 5a4 4 0 0 0 0 8h2.167M10 15V6m0 0L8 8m2-2 2 2" />
                  </svg>
                  <p className="mb-2 text-xs text-gray-400"><span className="font-semibold">Click to upload image</span></p>
                </div>
                <input type="file" className="hidden" accept="image/*" onChange={handleImageChange} />
              </label>
            </div>
          )}
        </div>

        {type === "mcq" && (
          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-semibold text-gray-300">Options</label>
              <span className="text-[10px] text-gray-500 uppercase">Select correct answers</span>
            </div>
            <div className="space-y-2">
              {options.map((opt, i) => (
                <div key={i} className={cn("flex items-center gap-3 p-2 rounded-lg border transition-all", opt.isCorrect ? "bg-green-500/5 border-green-500/30" : "bg-[#050505] border-white/5")}>
                  <button onClick={() => {
                    const newOpts = [...options];
                    newOpts[i].isCorrect = !newOpts[i].isCorrect;
                    setOptions(newOpts);
                  }} className="shrink-0 p-1">
                    {opt.isCorrect ? <CheckCircle2 className="h-5 w-5 text-green-500" /> : <Circle className="h-5 w-5 text-gray-600 hover:text-white" />}
                  </button>
                  <Input
                    value={opt.value}
                    onChange={e => {
                      const newOpts = [...options];
                      newOpts[i].value = e.target.value;
                      setOptions(newOpts);
                    }}
                    placeholder={`Option ${i + 1}`}
                    className="text-white h-8 shadow-none p-0 text-sm"
                  />
                  {options.length > 2 && (
                    <Button size="icon" variant="ghost" onClick={() => setOptions(options.filter((_, idx) => idx !== i))} className="h-7 w-7 text-gray-500 hover:text-red-400 shrink-0">
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
            {options.length < 5 && (
              <Button size="sm" variant="outline" onClick={() => setOptions([...options, { value: "", isCorrect: false }])} className="w-full bg-transparent border-dashed border-white/10 text-gray-400 hover:text-white hover:bg-white/5 mt-2">
                <Plus className="h-4 w-4 mr-2" /> Add Another Option
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="p-6 border-t border-white/5 bg-[#18181b] space-y-3 shrink-0">
        <Button onClick={() => handleSave(false)} disabled={isSaving} className="w-full bg-orange-600 hover:bg-orange-700 text-white font-semibold shadow-lg shadow-orange-950/40">
          {isSaving ? "Saving..." : "Save Question"}
        </Button>
        {!isEditMode && (
          <Button onClick={() => handleSave(true)} disabled={isSaving} variant="outline" className="w-full bg-transparent border-white/10 text-gray-300 hover:text-white hover:bg-white/5">
            Save & Add Another
          </Button>
        )}
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// AI EXAM GENERATOR FORM
// -------------------------------------------------------------
export type AiGeneratorStage = "config" | "intent" | "blueprint" | "generating";

export type WorkspaceParts = { left: React.ReactNode; right: React.ReactNode; footer: React.ReactNode; fill?: boolean; bare?: boolean };

// The Exam Intent conversation lives on the server, but this page only knows its id in memory. Keeping the id (and the
// topics form it belongs to) in this tab's session storage lets a refresh pick the same conversation up again.
type IntentSnapshot = {
  sessionId: string;
  inputKey: string;
  sections: any[];
  difficulty: Difficulty;
  mapping: SectionBlockMapEntry[];
  title: string;
};
const intentSnapshotKey = (examId: string) => `ai-exam-intent:${examId}`;
const readIntentSnapshot = (examId: string): IntentSnapshot | null => {
  try {
    const raw = sessionStorage.getItem(intentSnapshotKey(examId));
    return raw ? (JSON.parse(raw) as IntentSnapshot) : null;
  } catch {
    return null;
  }
};
const writeIntentSnapshot = (examId: string, snapshot: IntentSnapshot) => {
  try {
    sessionStorage.setItem(intentSnapshotKey(examId), JSON.stringify(snapshot));
  } catch {
    // Storage can be blocked; the conversation just won't survive a refresh.
  }
};
const clearIntentSnapshot = (examId: string) => {
  try {
    sessionStorage.removeItem(intentSnapshotKey(examId));
  } catch {
    // nothing to clean up
  }
};

export function AiExamGeneratorForm({
  examId,
  examDetail,
  existingSectionsCount = 0,
  existingSections = [],
  initialTargetSectionId = null,
  onBack,
  onSuccess,
  saveStatus = "PUBLISHED",
  renderShell,
  onStageChange,
  sourceBook = null,
}: {
  examId: string;
  examDetail?: any;
  existingSectionsCount?: number;
  existingSections?: any[];
  initialTargetSectionId?: string | null;
  onBack: () => void;
  onSuccess: () => void;
  // Omitting a status on save keeps the exam's current one (a new exam stays a draft).
  saveStatus?: "PUBLISHED" | null;
  // When given, each stage is split into main content, side panel and action bar instead of the inline layout.
  renderShell?: (parts: WorkspaceParts) => React.ReactNode;
  onStageChange?: (stage: AiGeneratorStage) => void;
  // "From Source" mode: questions are planned from and written using this book.
  sourceBook?: { id: string; title: string; toc: BookToc } | null;
}) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [genPhase, setGenPhase] = useState<"blueprint" | "questions">("blueprint");
  const [genProgress, setGenProgress] = useState<{ done: number; total: number; message?: string } | null>(null);

  // 4-Stage Workflow States: config form -> spoken intent conversation ->
  // interactive blueprint tree -> question generation, which saves
  // immediately and hands off to the real exam view (the Question Review
  // Agent lives there, not in this AI flow — see QuestionBuilder below).
  const { entitlements } = useEntitlements();
  // Text-chat counterpart of the voice intent conversation, used when voice
  // is turned off.
  const [intentHistory, setIntentHistory] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [intentReply, setIntentReply] = useState("");
  const [isIntentThinking, setIsIntentThinking] = useState(false);
  // The agent's question as it is being written; replaced by the finished message once the turn ends.
  const [intentStreaming, setIntentStreaming] = useState("");
  const intentStream = {
    onText: (delta: string) => setIntentStreaming((prev) => prev + delta),
    onReset: () => setIntentStreaming(""),
  };
  // Dictation: spoken words are added to what's already in the box and are never sent on their own.
  // Hold Space (anywhere on the page while the box is empty) or click the mic.
  const stt = useSpeechToText({
    onText: (t) => setIntentReply((prev) => (prev.trim() ? `${prev.trimEnd()} ` : "") + t),
    boxIsEmpty: !intentReply.trim(),
    enabled: !isIntentThinking,
    globalSpace: true,
  });
  const [aiStage, setAiStage] = useState<"config" | "intent" | "blueprint">("config");
  // The refinement chat is a full view of its own, opened from the plan, instead of a panel beside it.
  const [showRefine, setShowRefine] = useState(false);
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [blueprint, setBlueprint] = useState<LegacyBlueprintTree | null>(null);
  // Sections whose plan total differs from the count set on the form, shown in the dialog before generating.
  const [countMismatches, setCountMismatches] = useState<{ section: string; total: number; target: number; subtopics: number }[] | null>(null);
  const [isRebalancing, setIsRebalancing] = useState(false);

  // generation_agents backend session powering this exam end to end — created
  // by the Exam Intent Agent voice call below, then reused by blueprint
  // generation, the refinement chat, and question generation.
  const [sessionId, setSessionId] = useState<string | null>(null);
  // Refs (not state) so the voice hook's tool-result callback — captured once
  // when the WebRTC data channel opens — always reads the current value
  // instead of whatever was in scope at that moment.
  const sessionIdRef = useRef<string | null>(null);
  const mappingRef = useRef<SectionBlockMapEntry[]>([]);
  const examTitleRef = useRef<string>("Untitled Exam");
  // The topics the current conversation was started with; the same topics later mean "carry on with it".
  const intentKeyRef = useRef<string | null>(null);

  // "Latest callback" ref — proceedToBlueprintGeneration is defined further
  // down (it needs state setters declared below), but the voice hook is
  // created here and its tool-result handler is captured once when the
  // WebRTC data channel opens. Calling through this ref (updated on every
  // render, just below the real function's definition) means that handler
  // always invokes the current version instead of a stale one.
  const proceedToBlueprintGenerationRef = useRef<() => Promise<void>>(async () => {});

  const intentVoice = useRealtimeVoiceAgent({
    agent: "intent",
    onToolResult: (name) => {
      if (name === "save_exam_intent_summary") {
        void proceedToBlueprintGenerationRef.current();
      }
    },
  });

  // A "section" here maps 1:1 onto a generation_agents pipeline section
  // (subject + question type + count + topics) — there's no separate
  // "block" layer, since the pipeline has none.
  const [sections, setSections] = useState<any[]>([
    {
      id: Date.now().toString(),
      name: initialTargetSectionId
        ? (existingSections.find((s) => (s._id || s.id) === initialTargetSectionId)?.title || `Section ${String.fromCharCode(65 + existingSectionsCount)}`)
        : `Section ${String.fromCharCode(65 + existingSectionsCount)}`,
      targetSectionId: initialTargetSectionId || null,
      subject: "",
      topics: [""],
      questionType: "mcq",
      numberOfQuestions: "5",
      marksPerQuestion: "1"
    }
  ]);

  const sourceLookup = useMemo(() => (sourceBook ? buildSourceLookup(sourceBook.toc) : undefined), [sourceBook]);

  // Adds a book heading as a topic of the last section, filling an empty topic box first.
  const addTopicFromBook = (text: string) => {
    setSections((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      if (last.topics.some((t: string) => t.trim() === text)) return prev;
      const emptyIndex = last.topics.findIndex((t: string) => t.trim() === "");
      const topics = emptyIndex >= 0 ? last.topics.map((t: string, i: number) => (i === emptyIndex ? text : t)) : [...last.topics, text];
      return [...prev.slice(0, -1), { ...last, topics }];
    });
  };

  const addSection = () => {
    setSections(prev => [
      ...prev,
      {
        id: Date.now().toString(),
        name: `Section ${String.fromCharCode(65 + existingSectionsCount + prev.length)}`,
        targetSectionId: null,
        subject: "",
        topics: [""],
        questionType: "mcq",
        numberOfQuestions: "5",
        marksPerQuestion: "1"
      }
    ]);
  };

  const removeSection = (id: string) => {
    if (sections.length === 1) {
      toast.error("You must have at least one section");
      return;
    }
    setSections(prev => prev.filter(s => s.id !== id));
  };

  const updateSection = (id: string, field: string, value: any) => {
    setSections(prev => prev.map(s => s.id === id ? { ...s, [field]: value } : s));
  };

  const addTopicToSection = (sectionId: string) => {
    setSections(prev => prev.map(s => s.id === sectionId ? { ...s, topics: [...s.topics, ""] } : s));
  };

  const removeTopicFromSection = (sectionId: string, idx: number) => {
    setSections(prev => prev.map(s => {
      if (s.id !== sectionId) return s;
      const nextTopics = s.topics.filter((_: string, j: number) => j !== idx);
      return { ...s, topics: nextTopics.length === 0 ? [""] : nextTopics };
    }));
  };

  const updateTopicInSection = (sectionId: string, idx: number, val: string) => {
    setSections(prev => prev.map(s => {
      if (s.id !== sectionId) return s;
      const nextTopics = [...s.topics];
      nextTopics[idx] = val;
      return { ...s, topics: nextTopics };
    }));
  };

  // Step 1: build the pipeline's examInput from the config form and hand off
  // to a real, spoken Exam Intent Agent conversation — the config form's
  // UI is unchanged, but instead of a headless quick-start, the teacher now
  // actually talks through preferences before a blueprint is planned.
  const startIntentConversation = async () => {
    const invalid = sections.some((s) =>
      !s.name.trim() || !s.subject.trim() || s.topics.filter((t: string) => t.trim() !== "").length === 0 || Number(s.numberOfQuestions) <= 0
    );
    if (invalid) {
      toast.error("Please fill in each section's subject, topics, and question count");
      return;
    }

    const { examInput, mapping, title } = buildExamInputFromConfig(sections, [], sourceBook?.id, difficulty);
    mappingRef.current = mapping;
    examTitleRef.current = title;

    // Without the voice agent there is no spoken intent step, so the session
    // is created headlessly from the config form and the flow goes straight
    // to blueprint planning — the teacher still gets the whole pipeline,
    // minus the conversation their plan doesn't include.
    // Same Exam Intent Agent either way — the plan only decides whether the
    // teacher talks to it or types to it. The conversation itself, and
    // everything downstream of it, is identical.
    if (!entitlements.voiceAgent) {
      const inputKey = JSON.stringify(examInput);
      // Same topics as the conversation already under way: carry on with it (or its plan) instead of starting over.
      if (sessionIdRef.current && intentKeyRef.current === inputKey) {
        setAiStage(blueprint ? "blueprint" : "intent");
        return;
      }
      setAiStage("intent");
      setIsIntentThinking(true);
      setBlueprint(null);
      setIntentReply("");
      try {
        const result = await startExamIntentConversation(examInput, intentStream);
        sessionIdRef.current = result.sessionId;
        setSessionId(result.sessionId);
        intentKeyRef.current = inputKey;
        writeIntentSnapshot(examId, { sessionId: result.sessionId, inputKey, sections, difficulty, mapping, title });
        setIntentHistory([{ role: "assistant", content: result.message }]);
        if (result.done) void proceedToBlueprintGenerationRef.current();
      } catch (err: any) {
        toast.error(err?.response?.data?.message || err?.message || "Failed to start the exam intent conversation");
        setAiStage("config");
      } finally {
        setIsIntentThinking(false);
        setIntentStreaming("");
      }
      return;
    }

    setAiStage("intent");
    try {
      const newSessionId = await intentVoice.start({ examInput });
      sessionIdRef.current = newSessionId;
      setSessionId(newSessionId);
    } catch {
      toast.error(intentVoice.error || "Failed to start the exam intent conversation");
      setAiStage("config");
    }
  };

  // Step 2: once the Exam Intent Agent calls save_exam_intent_summary (voice
  // hook's onToolResult, wired above via proceedToBlueprintGenerationRef),
  // the session already has a real summary — trigger blueprint generation
  // exactly as before, just without the headless quick-start step.
  // Chat equivalent of a spoken turn. The voice agent signals completion via
  // its save_exam_intent_summary tool; in chat the same signal arrives as
  // `done` on the turn result, and both lead to the identical next step.
  const sendIntentReply = async () => {
    const sid = sessionIdRef.current;
    const outgoing = intentReply.trim();
    if (!sid || !outgoing || isIntentThinking) return;

    setIntentHistory((prev) => [...prev, { role: "user", content: outgoing }]);
    setIntentReply("");
    setIsIntentThinking(true);
    try {
      const result = await continueExamIntentConversation(sid, outgoing, intentStream);
      setIntentHistory((prev) => [...prev, { role: "assistant", content: result.message }]);
      if (result.done) void proceedToBlueprintGenerationRef.current();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || err?.message || "Conversation turn failed");
    } finally {
      setIsIntentThinking(false);
      setIntentStreaming("");
    }
  };

  // "Skip Question" — moves on to the agent's next question without
  // answering this one. Shown as a plain "Skipped" bubble in the transcript;
  // the actual control signal sent to the agent lives server-side.
  const skipIntentQuestion = async () => {
    const sid = sessionIdRef.current;
    if (!sid || isIntentThinking) return;

    setIntentHistory((prev) => [...prev, { role: "user", content: "(Skipped this question)" }]);
    setIsIntentThinking(true);
    try {
      const result = await skipExamIntentQuestion(sid, intentStream);
      setIntentHistory((prev) => [...prev, { role: "assistant", content: result.message }]);
      if (result.done) void proceedToBlueprintGenerationRef.current();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || err?.message || "Could not skip this question");
    } finally {
      setIsIntentThinking(false);
      setIntentStreaming("");
    }
  };

  // "Skip All Questions" — ends the conversation now. Whatever was already
  // discussed is kept; the rest is simply left out of the plan.
  const skipAllIntentQuestions = async () => {
    const sid = sessionIdRef.current;
    if (!sid || isIntentThinking) return;

    setIntentHistory((prev) => [...prev, { role: "user", content: "(Skipped all remaining questions)" }]);
    setIsIntentThinking(true);
    try {
      const result = await skipAllExamIntentQuestions(sid, intentStream);
      setIntentHistory((prev) => [...prev, { role: "assistant", content: result.message }]);
      // Always true from this endpoint, but keep the same guard as every
      // other completion path rather than assuming.
      if (result.done) void proceedToBlueprintGenerationRef.current();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || err?.message || "Could not skip the remaining questions");
    } finally {
      setIsIntentThinking(false);
      setIntentStreaming("");
    }
  };

  const proceedToBlueprintGeneration = async () => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    intentVoice.stop();

    setIsGenerating(true);
    setGenPhase("blueprint");
    setGenProgress(null);
    try {
      await triggerBlueprintGeneration(sid);

      let finalSections: ExamBlueprintSection[] | null = null;
      while (true) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const status = await getBlueprintStatus(sid);
        if (status.blueprintStatus === "completed" && status.blueprint) {
          finalSections = status.blueprint.sections;
          break;
        }
        if (status.blueprintStatus === "failed") {
          throw new Error(status.blueprintError || "Failed to plan subtopics");
        }
      }
      if (!finalSections) throw new Error("Blueprint generation returned no result");

      setBlueprint(sectionsToLegacyTree(finalSections, mappingRef.current, examTitleRef.current, []));
      setAiStage("blueprint");
      toast.success("Subtopics created!");
    } catch (err: any) {
      toast.error(err.response?.data?.message || err.message || "Failed to generate blueprint");
      setAiStage("config");
    } finally {
      setIsGenerating(false);
    }
  };
  proceedToBlueprintGenerationRef.current = proceedToBlueprintGeneration;

  // After a page refresh the form, the chat and the plan are gone from memory, but the conversation is saved on the
  // server. Read it back and put the teacher where they were.
  useEffect(() => {
    if (entitlements.voiceAgent) return;
    const saved = readIntentSnapshot(examId);
    if (!saved) return;
    let cancelled = false;
    (async () => {
      try {
        const convo = await getExamIntentConversation(saved.sessionId);
        if (cancelled) return;
        const planReady = convo.blueprintStatus === "completed" && !!convo.blueprint;
        const talking = convo.status === "in_progress" && convo.history.length > 0;
        if (!talking && !planReady) {
          clearIntentSnapshot(examId);
          return;
        }
        setSections(saved.sections);
        setDifficulty(saved.difficulty);
        mappingRef.current = saved.mapping;
        examTitleRef.current = saved.title;
        sessionIdRef.current = saved.sessionId;
        setSessionId(saved.sessionId);
        intentKeyRef.current = saved.inputKey;
        setIntentHistory(convo.history);
        if (planReady && convo.blueprint) {
          setBlueprint(sectionsToLegacyTree(convo.blueprint.sections, saved.mapping, saved.title, []));
          setAiStage("blueprint");
        } else {
          setAiStage("intent");
        }
      } catch {
        // The conversation is gone (deleted or not yours): start fresh.
        clearIntentSnapshot(examId);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [examId]);

  // Review edits change counts freely, so before generating, check each section's
  // total against the count set on the form and let the teacher decide.
  const handleVerifyAndProceed = async () => {
    if (!blueprint) return;
    const mismatches = legacyTreeToSections(blueprint, mappingRef.current).flatMap((section, i) => {
      const entry = mappingRef.current[i];
      const total = computeTotalQuestions([section]);
      if (!entry || total === entry.questionCount) return [];
      const subtopics = section.topics.reduce((n, t) => n + t.subtopics.length, 0);
      return [{ section: entry.sectionName, total, target: entry.questionCount, subtopics }];
    });
    if (mismatches.length > 0) {
      setCountMismatches(mismatches);
      return;
    }
    await executeFinalGeneration(blueprint);
  };

  // Rescales mismatched sections back to the form's counts, then leaves the
  // teacher on the plan to look it over before generating.
  const handleAutoBalance = async () => {
    if (!blueprint || !sessionId) return;
    setIsRebalancing(true);
    try {
      const { sections: balanced, changes } = await rebalanceBlueprint(sessionId, legacyTreeToSections(blueprint, mappingRef.current));
      setBlueprint(sectionsToLegacyTree(balanced, mappingRef.current, blueprint.title, blueprint.instructions || []));
      setCountMismatches(null);
      toast.success("Question counts balanced. Check the plan, then generate.");
      const removed = changes.flatMap((c) => c.changeLog.filter((line) => line.includes("were removed")));
      if (removed.length > 0) toast.warning(removed.join(" "), { duration: 8000 });
    } catch (err: any) {
      toast.error(err?.response?.data?.message || err?.message || "Could not balance the question counts");
    } finally {
      setIsRebalancing(false);
    }
  };

  const handleContinueWithNewCount = async () => {
    if (!blueprint) return;
    setCountMismatches(null);
    await executeFinalGeneration(blueprint);
  };

  // Final Step: trigger question generation (Inngest, section-wise, 5 topics
  // in parallel), poll for the result, and save the generated exam.
  const executeFinalGeneration = async (bpToUse: LegacyBlueprintTree) => {
    if (!sessionId) {
      toast.error("Missing generation session — please regenerate the blueprint.");
      return;
    }

    setIsGenerating(true);
    setGenPhase("questions");

    // Syncs whatever the tree editor (or refinement chat) last produced into
    // the session's blueprint right before generation starts.
    const flatSections = legacyTreeToSections(bpToUse, mappingRef.current);
    const totalQ = computeTotalQuestions(flatSections);
    setGenProgress({ done: 0, total: totalQ });

    try {
      await triggerQuestionGeneration(sessionId, flatSections);

      let finalQuestions: GeneratedExam | null = null;
      while (true) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const status = await getQuestionsStatus(sessionId);
        setGenProgress({ done: computeGeneratedCount(status.questions), total: totalQ });

        if (status.questionsStatus === "completed" && status.questions) {
          finalQuestions = status.questions;
          break;
        }
        if (status.questionsStatus === "failed") {
          throw new Error(status.questionsError || "Question generation failed");
        }
      }

      if (!finalQuestions) throw new Error("Generation returned no result");

      const saveShape = generatedExamToSaveShape(finalQuestions, mappingRef.current);
      await saveGeneratedExamService({
        ...saveShape,
        examId,
        ...(saveStatus ? { status: saveStatus } : {}),
      });

      toast.success("Questions generated successfully!");
      clearIntentSnapshot(examId);
      onSuccess();
    } catch (err: any) {
      toast.error(err.response?.data?.message || err.message || "Failed to generate questions");
    } finally {
      setIsGenerating(false);
    }
  };

  const currentStage: AiGeneratorStage = isGenerating ? "generating" : aiStage;
  useEffect(() => {
    onStageChange?.(currentStage);
  }, [currentStage]);

  let loaderNode: React.ReactNode = null;
  if (isGenerating) {
    const hasQuestionProgress = genPhase === "questions" && !!genProgress && genProgress.total > 0;
    const pct = hasQuestionProgress ? Math.min(100, Math.round((genProgress!.done / genProgress!.total) * 100)) : 0;
    const loaderTitle = genPhase === "questions"
      ? "Generating questions..."
      : "Planning subtopics...";

    loaderNode = (
      <div className="flex flex-col items-center justify-center py-24 space-y-5">
        <div className="w-16 h-16 rounded-full border-4 border-purple-500/20 border-t-purple-500 animate-spin" />
        <h4 className="text-lg font-bold text-white">{loaderTitle}</h4>
        {hasQuestionProgress && (
          <div className="w-full max-w-xs space-y-1.5">
            <div className="w-full bg-[#14151f] border border-white/10 rounded-full h-2 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-purple-500 to-orange-500 rounded-full transition-all duration-700"
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="text-xs text-purple-300 font-semibold text-center">
              {Math.min(genProgress!.done, genProgress!.total)} / {genProgress!.total}
            </p>
            {genProgress.message && (
              <p className="text-[11px] text-gray-400 text-center truncate max-w-[320px] mx-auto">
                {genProgress.message}
              </p>
            )}
          </div>
        )}
      </div>
    );
  }

  // A section in the plan lines up with entries in the section/block table by position, so renaming or deleting one
  // has to change the table too. A section's first entry is the number of blocks before it.
  const sectionEntryRange = (sIdx: number) => {
    const sections = blueprint?.sections ?? [];
    const start = sections.slice(0, sIdx).reduce((n, s) => n + s.blocks.length, 0);
    return [start, start + (sections[sIdx]?.blocks.length ?? 0)] as const;
  };

  const rememberMapping = () => {
    const saved = readIntentSnapshot(examId);
    if (saved) writeIntentSnapshot(examId, { ...saved, mapping: mappingRef.current });
  };

  const renameBlueprintSection = (sIdx: number, name: string) => {
    const [from, to] = sectionEntryRange(sIdx);
    mappingRef.current = mappingRef.current.map((m, i) => (i >= from && i < to ? { ...m, sectionName: name } : m));
    setBlueprint((prev) => (prev ? { ...prev, sections: prev.sections.map((s, i) => (i === sIdx ? { ...s, name } : s)) } : prev));
    rememberMapping();
  };

  const deleteBlueprintSection = (sIdx: number) => {
    const [from, to] = sectionEntryRange(sIdx);
    mappingRef.current = mappingRef.current.filter((_, i) => i < from || i >= to);
    setBlueprint((prev) => (prev ? { ...prev, sections: prev.sections.filter((_, i) => i !== sIdx) } : prev));
    rememberMapping();
  };

  const blueprintTreeNode = blueprint ? (
    <BlueprintTreeViewer
      blueprint={blueprint}
      onChange={setBlueprint}
      sourceLookup={sourceLookup}
      onRefine={() => setShowRefine(true)}
      onRenameSection={renameBlueprintSection}
      onDeleteSection={deleteBlueprintSection}
    />
  ) : null;

  const refinementChatNode = blueprint && sessionId ? (
    <BlueprintRefinementChat
      sessionId={sessionId}
      sections={legacyTreeToSections(blueprint, mappingRef.current)}
      onSectionsChange={(updatedSections) =>
        setBlueprint((prev) =>
          prev ? sectionsToLegacyTree(updatedSections, mappingRef.current, prev.title, prev.instructions || []) : prev
        )
      }
    />
  ) : null;

  const refineActions = (
    <Button
      variant="ghost"
      onClick={() => setShowRefine(false)}
      className="text-gray-400 hover:text-white h-10 px-5 text-sm font-semibold flex items-center gap-1.5"
    >
      <ArrowLeft className="h-4 w-4" /> Back to plan
    </Button>
  );

  const blueprintActions = (
    <>
      <Button
        variant="ghost"
        onClick={() => setAiStage("config")}
        className="text-gray-400 hover:text-white h-10 px-2 sm:px-5 text-sm font-semibold flex items-center gap-1.5"
      >
        <ArrowLeft className="h-4 w-4" /> {renderShell ? "Back to Topics" : "Edit Exam Settings"}
      </Button>

      <Button
        onClick={handleVerifyAndProceed}
        className="bg-purple-600 hover:bg-purple-700 text-white h-10 sm:h-11 px-4 sm:px-7 font-bold text-sm shadow-xl shadow-purple-950/40 rounded-xl transition-all hover:scale-[1.02] active:scale-[0.98]"
      >
        <Sparkles className="h-4 w-4 mr-1.5 sm:mr-2 text-purple-200" /> Generate Questions
      </Button>

      <Dialog open={countMismatches !== null} onOpenChange={(open) => !open && !isRebalancing && setCountMismatches(null)}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Question count changed</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-sm text-gray-300">
            {countMismatches?.map((m) => (
              <div key={m.section}>
                <p>
                  <span className="font-semibold text-white">{m.section}</span> now has {m.total} question{m.total === 1 ? "" : "s"}, but you set {m.target}.
                </p>
                {m.target < m.subtopics && (
                  <p className="text-xs text-amber-300">
                    Auto-balance can&apos;t give all {m.subtopics} subtopics a question, so some will be removed.
                  </p>
                )}
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCountMismatches(null)} disabled={isRebalancing}>
              Go back and adjust
            </Button>
            <Button variant="outline" onClick={handleContinueWithNewCount} disabled={isRebalancing}>
              Continue with new count
            </Button>
            <Button onClick={handleAutoBalance} disabled={isRebalancing} className="bg-purple-600 hover:bg-purple-700 text-white">
              {isRebalancing ? "Balancing..." : "Auto-balance"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );

  const configActions = (
    <>
      <Button variant="ghost" onClick={onBack} className="text-gray-400 hover:text-white h-10 px-5 text-sm font-semibold flex items-center gap-1.5">
        <ArrowLeft className="h-4 w-4" /> {renderShell ? "Previous" : "Cancel"}
      </Button>
      <Button onClick={startIntentConversation} className="bg-purple-600 hover:bg-purple-700 text-white h-11 px-8 font-bold text-sm shadow-xl shadow-purple-950/40 rounded-xl transition-all hover:scale-[1.02] active:scale-[0.98]">
        Next <ArrowRight className="h-4 w-4 ml-2" />
      </Button>
    </>
  );

  const intentActions = (
    <Button
      variant="ghost"
      onClick={() => {
        intentVoice.stop();
        setAiStage("config");
      }}
      className="text-gray-400 hover:text-white h-10 px-5 text-sm font-semibold flex items-center gap-1.5"
    >
      <ArrowLeft className="h-4 w-4" /> {renderShell ? "Back to Topics" : "Cancel"}
    </Button>
  );

  // Read-only recap shown next to the intent conversation, so the teacher can see what the agent is planning from.
  const intentChatNode = (
        <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-5">
          <div className="flex items-center justify-between">
            <h5 className="font-bold text-white text-base tracking-wider uppercase flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-orange-500" /> Exam Intent Agent
            </h5>
            {entitlements.voiceAgent && (
              <span
                className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${
                  intentVoice.status === "connected"
                    ? "bg-green-500/10 text-green-400"
                    : intentVoice.status === "connecting"
                    ? "bg-orange-500/10 text-orange-300"
                    : "bg-red-500/10 text-red-400"
                }`}
              >
                {intentVoice.status === "connected" ? "Live" : intentVoice.status}
              </span>
            )}
          </div>
          {!entitlements.voiceAgent ? (
            <>
              <div className="min-h-[8rem] flex-1 space-y-6">
                {intentHistory.length === 0 && !isIntentThinking && (
                  <p className="text-xs text-gray-500 italic">Starting the conversation...</p>
                )}
                {intentHistory.map((turn, i) => (
                  <div key={i} className={`group flex flex-col gap-0.5 ${turn.role === "user" ? "items-end" : "items-start"}`}>
                    <div
                      className={
                        turn.role === "user"
                          ? "max-w-[85%] rounded-3xl bg-orange-600 px-4 py-2.5 text-[15px] text-white"
                          : "max-w-full whitespace-pre-wrap text-[15px] leading-relaxed text-gray-100"
                      }
                    >
                      {turn.content}
                    </div>
                    <CopyButton text={turn.content} className="opacity-100 lg:opacity-0 lg:group-hover:opacity-100 focus-visible:opacity-100" />
                  </div>
                ))}
                {isIntentThinking && intentStreaming && (
                  <div className="flex flex-col items-start">
                    <div className="max-w-full whitespace-pre-wrap text-[15px] leading-relaxed text-gray-100">{intentStreaming}</div>
                  </div>
                )}
                {isIntentThinking && !intentStreaming && <p className="text-xs text-gray-500 italic">Thinking...</p>}
              </div>

              <div className="relative mt-auto space-y-1 bg-[#070708] pb-1 pt-2 lg:sticky lg:bottom-0">
                <ListeningIndicator stt={stt} />
                <div className={cn("flex items-end gap-2 rounded-3xl border bg-[#1b1b1d] py-1.5 pl-5 pr-1.5 transition-colors", stt.status === "recording" ? "border-red-500/60" : "border-white/10 focus-within:border-white/25")}>
                  <Textarea
                    rows={1}
                    value={intentReply}
                    onChange={(e) => setIntentReply(e.target.value)}
                    onKeyDown={(e) => {
                      if (stt.handleKeyDown(e)) return;
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        if (!isIntentThinking) void sendIntentReply();
                      }
                    }}
                    disabled={isIntentThinking}
                    placeholder="Type your answer, or hold Space to speak..."
                    className="min-h-0 max-h-40 flex-1 resize-none rounded-none border-0 bg-transparent px-0 py-2 text-[15px] text-white shadow-none placeholder:text-zinc-500"
                  />
                  <MicButton stt={stt} disabled={isIntentThinking} />
                  <Button
                    onClick={() => void sendIntentReply()}
                    disabled={isIntentThinking || !intentReply.trim()}
                    aria-label="Send"
                    className="h-9 w-9 shrink-0 rounded-full bg-orange-600 p-0 text-white hover:bg-orange-700 disabled:opacity-40"
                  >
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                </div>

                {/* Only meaningful once the agent has actually asked something. */}
                {intentHistory.length > 0 && (
                  <div className="flex items-center justify-center gap-1">
                    <Button
                      variant="ghost"
                      onClick={() => void skipIntentQuestion()}
                      disabled={isIntentThinking}
                      className="h-8 px-3 text-xs font-medium text-gray-400 hover:text-white"
                    >
                      Skip Question
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => void skipAllIntentQuestions()}
                      disabled={isIntentThinking}
                      className="h-8 px-3 text-xs font-medium text-gray-400 hover:text-white"
                    >
                      Skip All Questions
                    </Button>
                  </div>
                )}
              </div>
            </>
          ) : (
          <div className="space-y-3 max-h-96 overflow-y-auto custom-scrollbar pr-1 min-h-[160px]">
            {intentVoice.transcript.length === 0 && <p className="text-xs text-gray-500 italic">Listening...</p>}
            {intentVoice.transcript.map((turn, i) => (
              <div key={i} className={`flex ${turn.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] rounded-lg px-3.5 py-2.5 text-sm ${
                    turn.role === "user" ? "bg-orange-600 text-white" : "bg-zinc-900 border border-white/10 text-gray-200"
                  }`}
                >
                  {turn.text}
                </div>
              </div>
            ))}
            {intentVoice.partial && (
              <div className={`flex ${intentVoice.partial.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] rounded-lg px-3.5 py-2.5 text-sm italic opacity-70 ${
                    intentVoice.partial.role === "user" ? "bg-orange-600 text-white" : "bg-zinc-900 border border-white/10 text-gray-200"
                  }`}
                >
                  {intentVoice.partial.text}
                </div>
              </div>
            )}
          </div>
          )}
        </div>
  );

  const configFormNode = (
          <div className="space-y-8">
            <div className="flex items-center justify-between gap-3">
              <h5 className="font-bold text-white text-sm sm:text-base tracking-wider uppercase leading-tight">EXAM SETTINGS & SECTIONS</h5>
              <Button
                type="button"
                onClick={addSection}
                size="sm"
                className="shrink-0 bg-orange-600 hover:bg-orange-700 text-white text-xs font-semibold rounded-xl shadow-md shadow-orange-950/40 h-9 px-3 sm:px-4"
              >
                <Plus className="h-4 w-4 mr-1.5" /> Add Section
              </Button>
            </div>

            {/* DIFFICULTY LEVEL */}
            <div className="space-y-1.5 pb-2">
              <label className="text-xs font-bold text-gray-300 uppercase tracking-wider block">DIFFICULTY LEVEL</label>
              <Select value={difficulty} onValueChange={(val) => { if (val) setDifficulty(val as Difficulty); }}>
                <SelectTrigger className="w-full sm:w-48 text-white h-9 text-xs font-semibold">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#14151f] border border-white/15 text-white text-xs">
                  <SelectItem value="easy">Easy</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="hard">Hard</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* SECTIONS & TOPICS */}
            <div className="space-y-5">
              <label className="text-xs font-bold text-gray-300 uppercase tracking-wider">SECTIONS & TOPICS</label>

              <div className="space-y-8">
{sections.map((section) => (
                  <div key={section.id} className="space-y-4">
                    {existingSections.length > 0 && (
                      <div className="space-y-1">
                        <label className="text-[11px] font-bold text-gray-300 uppercase tracking-wider block">ADD TO</label>
                        <Select
                          value={section.targetSectionId || "__new__"}
                          onValueChange={(val) => updateSection(section.id, 'targetSectionId', val === "__new__" ? null : val)}
                        >
                          <SelectTrigger className="w-full text-white h-9 text-xs font-semibold">
                            {/* Show the section's name, not its id. */}
                            <SelectValue>
                              {(val: string) =>
                                val === "__new__" ? "+ Create New Section" : existingSections.find((es) => (es._id || es.id) === val)?.title ?? val
                              }
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent className="bg-[#14151f] border border-white/15 text-white text-xs">
                            <SelectItem value="__new__">+ Create New Section</SelectItem>
                            {existingSections.map((es) => (
                              <SelectItem key={es._id || es.id} value={es._id || es.id}>
                                {es.title}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}

                    <div className="flex items-center justify-between">
                      {section.targetSectionId ? (
                        <span className="text-white text-base font-bold h-8 flex items-center">
                          {existingSections.find((es) => (es._id || es.id) === section.targetSectionId)?.title || section.name}
                        </span>
                      ) : (
                        <Input
                          value={section.name}
                          onChange={e => updateSection(section.id, 'name', e.target.value)}
                          className="text-white text-base font-bold h-8 p-0"
                          placeholder="Section Name"
                          required
                        />
                      )}
                      {sections.length > 1 && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => removeSection(section.id)}
                          className="bg-transparent border-red-500/20 text-red-400 hover:bg-red-500/10 h-8 px-2.5 text-xs font-semibold shrink-0"
                        >
                          Remove
                        </Button>
                      )}
                    </div>

                    <div className="space-y-1">
                      <label className="text-[11px] font-bold text-gray-300 uppercase tracking-wider block">SUBJECT</label>
                      <Input
                        value={section.subject}
                        onChange={e => updateSection(section.id, 'subject', e.target.value)}
                        placeholder="Subject (e.g. JavaScript)"
                        className="text-white text-xs font-bold h-8 w-full"
                        required
                      />
                    </div>

                    {/* TOPICS */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-3">
                        <label className="text-[11px] font-bold leading-none text-gray-300 uppercase tracking-wider">TOPICS</label>
                        <Button
                          type="button"
                          onClick={() => addTopicToSection(section.id)}
                          className="h-7 px-3 bg-orange-600 hover:bg-orange-700 text-white text-xs font-semibold rounded-lg"
                        >
                          <Plus className="h-3 w-3 mr-1" /> Add Topic
                        </Button>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {section.topics.map((topic: string, tIdx: number) => (
                          <div key={tIdx} className="flex items-center gap-2">
                            <Input
                              value={topic}
                              onChange={e => updateTopicInSection(section.id, tIdx, e.target.value)}
                              placeholder={`Topic ${tIdx + 1}`}
                              className="text-white placeholder:text-zinc-400 h-8 text-xs flex-1"
                              required
                            />
                            {section.topics.length > 1 && (
                              <button
                                type="button"
                                onClick={() => removeTopicFromSection(section.id, tIdx)}
                                className="text-gray-400 hover:text-red-400 transition-colors p-1 shrink-0"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* TYPE, QUESTIONS, MARKS EACH */}
                    <div className="grid grid-cols-3 gap-3">
                      <div className="space-y-1">
                        <label className="text-[11px] font-bold text-gray-300 uppercase tracking-wider block">TYPE</label>
                        <Select value={section.questionType} onValueChange={val => updateSection(section.id, 'questionType', val)}>
                          <SelectTrigger className="w-full text-white h-8 text-xs font-semibold">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="bg-[#14151f] border border-white/15 text-white text-xs">
                            <SelectItem value="mcq">MCQ</SelectItem>
                            <SelectItem value="descriptive">Descriptive</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[11px] font-bold text-gray-300 uppercase tracking-wider block">QUESTIONS</label>
                        <Input
                          type="number"
                          min="1"
                          max="50"
                          value={section.numberOfQuestions}
                          onChange={e => updateSection(section.id, 'numberOfQuestions', e.target.value)}
                          className="text-white h-8 text-xs font-bold text-center"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[11px] font-bold text-gray-300 uppercase tracking-wider block">MARKS EACH</label>
                        <Input
                          type="number"
                          min="1"
                          value={section.marksPerQuestion}
                          onChange={e => updateSection(section.id, 'marksPerQuestion', e.target.value)}
                          className="text-white h-8 text-xs font-bold text-center"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
  );

  const bookGuideNode = sourceBook ? (
    <div className="bg-[#0f0f11] border border-white/10 rounded-2xl p-4 space-y-3">
      <div>
        <h6 className="font-bold text-white text-xs tracking-wider uppercase">From this book</h6>
        <p className="text-[11px] text-gray-400 mt-0.5">{sourceBook.title}. Click a heading to add it as a topic.</p>
      </div>
      <div className="space-y-2.5 max-h-[420px] overflow-y-auto custom-scrollbar pr-1">
        {sourceBook.toc.chapters.map((chapter) => (
          <div key={chapter.id} className="space-y-1.5">
            <button
              type="button"
              onClick={() => addTopicFromBook(chapter.title)}
              className="w-full text-left text-xs font-semibold text-gray-100 hover:text-orange-300 transition-colors"
            >
              {chapter.title}
            </button>
            <div className="flex flex-wrap gap-1.5 pl-2">
              {chapter.sections
                .filter((section) => !section.headingGenerated)
                .map((section) => (
                  <button
                    key={section.id}
                    type="button"
                    onClick={() => addTopicFromBook(section.heading)}
                    className="text-[11px] px-2 py-0.5 rounded-full border border-white/10 bg-white/5 text-gray-300 hover:border-orange-500/40 hover:text-orange-200 transition-colors"
                  >
                    {section.heading}
                  </button>
                ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  ) : null;

  if (renderShell) {
    if (isGenerating) return renderShell({ left: loaderNode, right: bookGuideNode, footer: null, bare: true });
    if (aiStage === "blueprint" && blueprint) {
      if (showRefine) return renderShell({ left: refinementChatNode, right: null, footer: refineActions, fill: true });
      return renderShell({ left: blueprintTreeNode, right: null, footer: blueprintActions });
    }
    if (aiStage === "intent") return renderShell({ left: intentChatNode, right: null, footer: intentActions, fill: true, bare: true });
    return renderShell({ left: configFormNode, right: bookGuideNode, footer: configActions, bare: true });
  }

  if (isGenerating) return loaderNode;

  const actionBarClass = "sticky bottom-0 z-40 bg-[#050505]/95 backdrop-blur-xl border-t border-white/10 p-4 rounded-t-2xl shadow-2xl flex items-center justify-between gap-4";

  return (
    <div className="space-y-0 animate-in fade-in slide-in-from-bottom-1 duration-150 w-full max-w-full px-2 pb-6">
      {aiStage === "blueprint" && blueprint ? (
        <div className="space-y-6">
          {showRefine ? refinementChatNode : blueprintTreeNode}
          <div className={actionBarClass}>{showRefine ? refineActions : blueprintActions}</div>
        </div>
      ) : aiStage === "intent" ? (
        <>
          {intentChatNode}
          <div className={cn(actionBarClass, "-mx-1 mt-10")}>{intentActions}</div>
        </>
      ) : (
        <>
          <div className={cn("grid grid-cols-1 gap-6 items-start w-full", bookGuideNode ? "lg:grid-cols-[1fr_320px]" : "mx-auto max-w-3xl")}>
            {configFormNode}
            {bookGuideNode && <div className="sticky top-6">{bookGuideNode}</div>}
          </div>
          <div className={cn(actionBarClass, "-mx-1 mt-10")}>{configActions}</div>
        </>
      )}
    </div>
  );
}
