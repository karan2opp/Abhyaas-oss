"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, Check, FileText, Loader2, Minus, Plus, Search, UploadCloud, X, Sparkles, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  listQuestionBankDocuments,
  uploadQuestionBankDocument,
  generateQuestionsFromDocuments,
  listPaperTopics,
  PaperTopic,
  PickedTopicInput,
  QuestionBankDocument,
  GeneratedTopicGroup,
  GeneratedQuestion,
  QuestionType,
} from "@/services/questionBank.service";
import { saveGeneratedExamService } from "@/app/teacher/exams/exam.service";
import type { WorkspaceParts } from "./QuestionBuilder";
import { StatTile } from "./workspace";
import { ContentBlocksView, MarkdownCode, OptionValue } from "@/components/QuestionContentBlocks";
import ReactMarkdown from "react-markdown";
import { normalizeCodeBlocks } from "@/lib/markdown";
import { MATH_REMARK_PLUGINS, MATH_REHYPE_PLUGINS } from "@/lib/markdownMath";

export type PyqStage = "papers" | "settings" | "preview";

// Until the questions are added to the exam, what the teacher has picked (papers, topics, settings and the questions
// found) lives only in this page, so a reload would start over. It is also kept in this browser, per exam, and cleared
// once the questions are added or the exam is discarded.
const progressKey = (examId: string) => `pyq-progress:${examId}`;
const PROGRESS_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

type PickedTopic = PickedTopicInput;

type PyqProgress = {
  savedAt: number;
  stage: PyqStage;
  selectedDocIds: string[];
  // Progress saved before topics were picked this way has neither of these.
  picked?: PickedTopic[];
  goal?: string;
  questionType: QuestionType;
  marks: string;
  results: GeneratedTopicGroup[] | null;
  removedIds: string[];
};

export function clearPyqProgress(examId: string) {
  try {
    localStorage.removeItem(progressKey(examId));
  } catch {
    // nothing to clear
  }
}

function readPyqProgress(examId: string): PyqProgress | null {
  try {
    const raw = localStorage.getItem(progressKey(examId));
    if (!raw) return null;
    const saved = JSON.parse(raw) as PyqProgress;
    if (Date.now() - saved.savedAt > PROGRESS_MAX_AGE_MS) {
      clearPyqProgress(examId);
      return null;
    }
    return saved;
  } catch {
    return null;
  }
}

const MCQ_LETTERS = ["A", "B", "C", "D", "E", "F"];

const fieldClass = "text-white placeholder:text-zinc-500 h-9 text-sm";
const selectClass = "w-full text-white h-9 text-sm rounded-none border-0 border-b border-white/20 bg-transparent px-0 transition-colors placeholder:text-zinc-500 focus:border-orange-500 focus:outline-none focus:ring-0";
const primaryButton = "bg-purple-600 hover:bg-purple-700 text-white h-10 px-6 font-bold text-sm rounded-xl shadow-lg shadow-purple-950/40";
const ghostButton = "text-gray-400 hover:text-white h-10 px-4 text-sm font-semibold";

function PickedTopicRow({ row, available, onCount, onRemove }: { row: PickedTopic; available: number | null; onCount: (n: number) => void; onRemove: () => void }) {
  const max = available ?? 50;
  const stepButton = "flex h-9 w-9 items-center justify-center rounded-md text-gray-300 transition-colors hover:bg-white/5 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent";
  return (
    <li className="flex items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-white">{row.topic}</p>
        <p className="text-[11px] text-gray-500">{available === null ? "Matched by meaning" : `${available} available`}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button type="button" aria-label={`Fewer questions for ${row.topic}`} disabled={row.count <= 1} onClick={() => onCount(row.count - 1)} className={stepButton}>
          <Minus className="h-3.5 w-3.5" />
        </button>
        <span className="w-7 text-center text-sm font-bold tabular-nums text-white">{row.count}</span>
        <button type="button" aria-label={`More questions for ${row.topic}`} disabled={row.count >= max} onClick={() => onCount(row.count + 1)} className={stepButton}>
          <Plus className="h-3.5 w-3.5" />
        </button>
        <button type="button" aria-label={`Remove ${row.topic}`} onClick={onRemove} className="ml-1 flex h-9 w-9 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-red-500/10 hover:text-red-400">
          <X className="h-4 w-4" />
        </button>
      </div>
    </li>
  );
}

function OwnTopicInput({ onAdd }: { onAdd: (topic: string) => void }) {
  const [value, setValue] = useState("");
  const submit = () => {
    const topic = value.trim();
    if (!topic) return;
    onAdd(topic);
    setValue("");
  };
  return (
    <div className="flex gap-2">
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        placeholder="Type your own topic and press Enter"
        className={cn(fieldClass, "flex-1")}
      />
      <Button type="button" variant="outline" onClick={submit} className="h-9 bg-transparent border-white/15 text-gray-200 hover:bg-white/5">
        <Plus className="h-3.5 w-3.5 mr-1" /> Add
      </Button>
    </div>
  );
}

function RetrievedQuestion({ q, index, documentTitle, removed, onToggle }: { q: GeneratedQuestion; index: number; documentTitle: string; removed: boolean; onToggle: () => void }) {
  return (
    <div
      className={cn(
        "bg-[#18181b]/60 border border-white/5 rounded-2xl p-6 relative overflow-hidden shadow-sm transition-all",
        removed ? "opacity-40" : "hover:shadow-md hover:border-white/10"
      )}
    >
      <div className="absolute top-0 left-0 bg-orange-500/10 text-orange-400 font-mono text-xs font-bold px-3 py-1.5 rounded-br-xl border-b border-r border-orange-500/30">
        Q{index + 1}
      </div>

      <div className="absolute top-4 right-4">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={onToggle}
          className={cn(
            "h-8 px-3 text-xs font-semibold bg-transparent",
            removed ? "border-white/15 text-gray-300 hover:bg-white/5" : "border-red-500/20 text-red-400 hover:bg-red-500/10"
          )}
        >
          {removed ? "Keep" : "Remove"}
        </Button>
      </div>

      <div className="pt-4">
        <div className="flex items-center gap-2 mb-4">
          <span
            className={cn(
              "px-2.5 py-1 rounded-md text-[10px] uppercase font-bold tracking-wider",
              q.type === "mcq" ? "bg-orange-500/10 text-orange-400 border border-orange-500/30" : "bg-amber-500/10 text-amber-400 border border-amber-500/20"
            )}
          >
            {q.type === "mcq" ? "Multiple Choice" : "Descriptive"}
          </span>
          <span className="border border-white/10 bg-white/5 px-2.5 py-1 rounded-md text-gray-300 text-[10px] font-bold">Marks: {q.marks}</span>
        </div>

        <div className="text-white text-[15px] leading-relaxed mb-6 font-medium prose prose-invert max-w-none pr-20">
          <ReactMarkdown
            remarkPlugins={MATH_REMARK_PLUGINS}
            rehypePlugins={MATH_REHYPE_PLUGINS}
            components={{
              pre: ({ children }) => (
                <div className="my-5 rounded-xl overflow-hidden border border-white/10 bg-[#09090b] shadow-2xl">
                  <div className="p-5 overflow-x-auto custom-scrollbar font-normal">{children}</div>
                </div>
              ),
              code: ({ className, children }) => (
                <MarkdownCode className={className} size="compact">
                  {children}
                </MarkdownCode>
              ),
              p: ({ ...props }) => <p className="mb-2 last:mb-0" {...props} />,
            }}
          >
            {normalizeCodeBlocks(q.question_text)}
          </ReactMarkdown>
        </div>

        <div className="max-w-3xl -mt-3 mb-5">
          <ContentBlocksView blocks={q.content_blocks} size="compact" />
        </div>

        {q.type === "mcq" && q.options && q.options.length > 0 && (
          <div className="space-y-2.5 max-w-3xl">
            {q.options.map((opt, oi) => {
              const isCorrect = MCQ_LETTERS[oi] === q.correct_option;
              return (
                <div
                  key={oi}
                  className={cn(
                    "flex items-center p-3.5 rounded-xl border border-white/5 bg-[#0f0f11] text-[14px] transition-all duration-200 hover:bg-white/5 hover:border-white/10",
                    isCorrect ? "text-white" : "text-gray-400"
                  )}
                >
                  {isCorrect ? (
                    <span className="mr-3.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-green-500">
                      <Check className="h-3 w-3 text-white" strokeWidth={3.5} />
                    </span>
                  ) : (
                    <div className="mr-3.5 h-5 w-5 shrink-0 rounded-full border-2 border-gray-600" />
                  )}
                  <span className="font-medium">
                    <OptionValue value={opt} size="compact" />
                  </span>
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-x-2 text-[11px] text-gray-500">
          <span>
            from {documentTitle}
            {q.source.questionNumber ? ` · Q${q.source.questionNumber}` : ""} · page {q.source.pageStart}
          </span>
          {q.type === "mcq" && !q.correct_option && (
            <span className="inline-flex items-center gap-1 text-amber-400">
              <AlertTriangle className="h-3 w-3" /> No answer key in the paper, set one after adding
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export function PyqFlow({
  examId,
  onBack,
  onSuccess,
  renderShell,
  onStageChange,
}: {
  examId: string;
  onBack: () => void;
  onSuccess: () => void;
  renderShell: (parts: WorkspaceParts) => React.ReactNode;
  onStageChange?: (stage: PyqStage) => void;
}) {
  // Where the teacher left off before a reload, if they did.
  const [saved] = useState(() => readPyqProgress(examId));
  const [stage, setStage] = useState<PyqStage>(saved ? (saved.stage === "preview" && !saved.results ? "settings" : saved.stage) : "papers");
  const [documents, setDocuments] = useState<QuestionBankDocument[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>(saved?.selectedDocIds ?? []);

  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadTitle, setUploadTitle] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [picked, setPicked] = useState<PickedTopic[]>(saved?.picked ?? []);
  const [goal, setGoal] = useState(saved?.goal ?? "");
  const [questionType, setQuestionType] = useState<QuestionType>(saved?.questionType ?? "mcq");
  const [marks, setMarks] = useState(saved?.marks ?? "2");
  const [paperTopics, setPaperTopics] = useState<PaperTopic[]>([]);
  const [loadingTopics, setLoadingTopics] = useState(false);
  const [topicSearch, setTopicSearch] = useState("");

  const [isRetrieving, setIsRetrieving] = useState(false);
  const [results, setResults] = useState<GeneratedTopicGroup[] | null>(saved?.results ?? null);
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set(saved?.removedIds ?? []));
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    onStageChange?.(stage);
  }, [stage]);

  useEffect(() => {
    try {
      const progress: PyqProgress = { savedAt: Date.now(), stage, selectedDocIds, picked, goal, questionType, marks, results, removedIds: [...removedIds] };
      localStorage.setItem(progressKey(examId), JSON.stringify(progress));
    } catch {
      // Not remembering is harmless.
    }
  }, [examId, stage, selectedDocIds, picked, goal, questionType, marks, results, removedIds]);

  // The topics found in the chosen papers, read when the settings step opens. Keyed on the ids as text so the list
  // isn't fetched again every time the papers list refreshes.
  const selectedKey = selectedDocIds.join(",");
  useEffect(() => {
    if (stage !== "settings" || !selectedKey) return;
    let cancelled = false;
    setLoadingTopics(true);
    listPaperTopics(selectedKey.split(","))
      .then((topics) => {
        if (!cancelled) setPaperTopics(topics);
      })
      .catch((err: any) => toast.error(err?.response?.data?.message || "Could not read the topics in your papers"))
      .finally(() => {
        if (!cancelled) setLoadingTopics(false);
      });
    return () => {
      cancelled = true;
    };
  }, [stage, selectedKey]);

  const loadDocuments = async () => {
    try {
      const docs = await listQuestionBankDocuments();
      setDocuments(docs);
      // A paper picked before a reload may have been deleted since.
      setSelectedDocIds((prev) => prev.filter((id) => docs.some((d) => d.id === id)));
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Failed to load papers");
    } finally {
      setLoadingDocs(false);
    }
  };

  useEffect(() => {
    void loadDocuments();
  }, []);

  const hasProcessing = documents.some((d) => d.status === "pending" || d.status === "processing");
  useEffect(() => {
    if (!hasProcessing) return;
    const timer = setInterval(() => void loadDocuments(), 4000);
    return () => clearInterval(timer);
  }, [hasProcessing]);

  const documentTitles = useMemo(() => Object.fromEntries(documents.map((d) => [d.id, d.title])), [documents]);
  const selectedDocs = documents.filter((d) => selectedDocIds.includes(d.id));
  const totalQuestions = picked.reduce((sum, p) => sum + p.count, 0);

  // Topics are compared ignoring capitals and stray spaces, so "Ohm's law" and "ohm's law " are one topic.
  const topicKey = (topic: string) => topic.trim().toLowerCase();
  const pickedKeys = new Set(picked.map((p) => topicKey(p.topic)));
  const availableIn = (t: PaperTopic) => (questionType === "mcq" ? t.mcq : t.descriptive);
  // Only topics that have questions of the chosen type are offered.
  const visibleTopics = paperTopics.filter((t) => availableIn(t) > 0);
  const topicQuery = topicSearch.trim().toLowerCase();
  const shownTopics = topicQuery ? visibleTopics.filter((t) => t.topic.toLowerCase().includes(topicQuery)) : visibleTopics;
  // How many questions a picked topic can give: known for topics from the papers, open for ones the teacher typed.
  const availableFor = (row: PickedTopic) => {
    if (!row.fromPapers) return null;
    const found = paperTopics.find((t) => topicKey(t.topic) === topicKey(row.topic));
    return found ? availableIn(found) : null;
  };

  const togglePaperTopic = (t: PaperTopic) =>
    setPicked((prev) =>
      prev.some((p) => topicKey(p.topic) === topicKey(t.topic))
        ? prev.filter((p) => topicKey(p.topic) !== topicKey(t.topic))
        : [...prev, { topic: t.topic, count: Math.min(3, availableIn(t)), fromPapers: true }]
    );
  const addOwnTopic = (topic: string) =>
    setPicked((prev) => (prev.some((p) => topicKey(p.topic) === topicKey(topic)) ? prev : [...prev, { topic, count: 3, fromPapers: false }]));
  const setPickedCount = (topic: string, count: number) => setPicked((prev) => prev.map((p) => (topicKey(p.topic) === topicKey(topic) ? { ...p, count } : p)));
  // Switching between MCQ and descriptive changes how many questions each topic has, so picks are trimmed to fit.
  const changeQuestionType = (type: QuestionType) => {
    setQuestionType(type);
    if (paperTopics.length === 0) return;
    setPicked((prev) =>
      prev.flatMap((p) => {
        if (!p.fromPapers) return [p];
        const found = paperTopics.find((t) => topicKey(t.topic) === topicKey(p.topic));
        const available = found ? (type === "mcq" ? found.mcq : found.descriptive) : 0;
        return available > 0 ? [{ ...p, count: Math.min(p.count, available) }] : [];
      })
    );
  };

  const keptQuestions = (results ?? []).flatMap((g) => g.questions.filter((q) => !removedIds.has(q.id)));
  const keptMarks = keptQuestions.reduce((sum, q) => sum + (Number(q.marks) || 0), 0);

  const toggleDocument = (id: string) =>
    setSelectedDocIds((prev) => (prev.includes(id) ? prev.filter((d) => d !== id) : [...prev, id]));

  const handleUpload = async () => {
    if (!uploadFile) {
      toast.error("Choose a PDF to upload");
      return;
    }
    setIsUploading(true);
    try {
      await uploadQuestionBankDocument(uploadFile, uploadTitle);
      toast.success("Paper uploaded. It will be ready to select once processing finishes.");
      setUploadFile(null);
      setUploadTitle("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      await loadDocuments();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Upload failed");
    } finally {
      setIsUploading(false);
    }
  };

  const handleRetrieve = async () => {
    if (picked.length === 0) {
      toast.error("Pick at least one topic");
      return;
    }
    const marksEach = Number(marks);
    if (!marksEach || marksEach < 1) {
      toast.error("Marks per question must be at least 1");
      return;
    }
    if (totalQuestions > 100) {
      toast.error("You can ask for at most 100 questions at once");
      return;
    }

    setIsRetrieving(true);
    setStage("preview");
    try {
      const groups = await generateQuestionsFromDocuments({
        documentIds: selectedDocIds,
        topics: picked,
        goal: goal.trim() || undefined,
        questionType,
        marks: marksEach,
      });
      setResults(groups);
      setRemovedIds(new Set());
    } catch (err: any) {
      toast.error(err?.response?.data?.message || err?.message || "Could not retrieve questions");
      setStage("settings");
    } finally {
      setIsRetrieving(false);
    }
  };

  const handleAddToExam = async () => {
    if (!results || keptQuestions.length === 0) {
      toast.error("Keep at least one question to add");
      return;
    }
    setIsSaving(true);
    try {
      const blocks = results
        .map((g) => {
          const questions = g.questions
            .filter((q) => !removedIds.has(q.id))
            .map((q) =>
              q.type === "mcq"
                ? {
                    type: "mcq",
                    description: q.question_text,
                    marks: q.marks,
                    contentBlocks: q.content_blocks ?? [],
                    options: (q.options ?? []).map((opt, i) => ({ value: opt, isCode: false, isCorrect: MCQ_LETTERS[i] === q.correct_option })),
                  }
                : { type: "descriptive", description: q.question_text, marks: q.marks, contentBlocks: q.content_blocks ?? [] }
            );
          return {
            name: g.topic,
            subject: "",
            question_type: questionType,
            total_marks: questions.reduce((s, q) => s + (Number(q.marks) || 0), 0),
            instructions: [],
            questions,
          };
        })
        .filter((b) => b.questions.length > 0);

      await saveGeneratedExamService({ examId, sections: [{ name: "Section A", blocks }] });
      toast.success(`${keptQuestions.length} question(s) added to the exam`);
      clearPyqProgress(examId);
      onSuccess();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || err?.message || "Failed to add questions");
    } finally {
      setIsSaving(false);
    }
  };

  if (stage === "papers") {
    const left = (
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-bold text-white">Choose past papers</h2>
          <p className="text-xs text-gray-400 mt-0.5">Questions will only be taken from the papers you tick. Upload new ones from the panel on the right.</p>
        </div>
        {loadingDocs ? (
          <div className="flex items-center gap-2 text-sm text-gray-400 py-10 justify-center">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading papers...
          </div>
        ) : documents.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/15 p-4 sm:p-6 md:p-10 text-center space-y-2">
            <FileText className="h-8 w-8 text-gray-600 mx-auto" />
            <p className="text-sm text-gray-300 font-semibold">No papers yet</p>
            <p className="text-xs text-gray-500">Upload a past paper PDF from the panel on the right to get started.</p>
          </div>
        ) : (
          <div className="grid gap-2">
            {documents.map((doc) => {
              const ready = doc.status === "completed";
              const checked = selectedDocIds.includes(doc.id);
              return (
                <label
                  key={doc.id}
                  className={cn(
                    "flex items-center gap-3 rounded-xl border p-3.5 transition-colors",
                    ready ? "cursor-pointer" : "cursor-not-allowed opacity-60",
                    checked ? "border-orange-500/50 bg-orange-500/5" : "border-white/10 bg-[#0f0f11] hover:bg-[#15151a]"
                  )}
                >
                  <input type="checkbox" disabled={!ready} checked={checked} onChange={() => toggleDocument(doc.id)} className="h-4 w-4 accent-orange-500" />
                  <FileText className="h-4 w-4 text-gray-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white truncate">{doc.title}</p>
                    <p className="text-[11px] text-gray-500">
                      {doc.status === "failed" && doc.error ? doc.error : "Private"}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "text-[11px] font-semibold shrink-0",
                      ready && "text-gray-400",
                      (doc.status === "pending" || doc.status === "processing") && "text-amber-400",
                      doc.status === "failed" && "text-red-400"
                    )}
                  >
                    {ready ? `${doc.totalChunks} questions` : doc.status === "failed" ? "Failed" : "Processing..."}
                  </span>
                </label>
              );
            })}
          </div>
        )}
      </div>
    );

    const right = (
      <div className="space-y-4">
        <div className="rounded-xl border border-white/10 bg-[#0f0f11] p-4 space-y-3">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <UploadCloud className="h-4 w-4 text-orange-400" /> Upload a paper
          </h3>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
            className="block w-full text-xs text-gray-400 file:mr-3 file:rounded-lg file:border-0 file:bg-white/10 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-white hover:file:bg-white/15"
          />
          <Input value={uploadTitle} onChange={(e) => setUploadTitle(e.target.value)} placeholder="Title (optional)" className={fieldClass} />
          <Button onClick={handleUpload} disabled={isUploading || !uploadFile} className="w-full bg-orange-600 hover:bg-orange-700 text-white h-9 text-sm font-semibold">
            {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Upload"}
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <StatTile label="Selected" value={selectedDocIds.length} tone="text-orange-300" />
          <StatTile label="Questions" value={selectedDocs.reduce((n, d) => n + d.totalChunks, 0)} tone="text-purple-300" />
        </div>
      </div>
    );

    const footer = (
      <>
        <Button variant="ghost" onClick={onBack} className={ghostButton}>
          <ArrowLeft className="h-4 w-4 mr-1.5" /> Previous
        </Button>
        <Button
          onClick={() => (selectedDocIds.length === 0 ? toast.error("Select at least one paper") : setStage("settings"))}
          className={primaryButton}
        >
          Next <ArrowRight className="h-4 w-4 ml-2" />
        </Button>
      </>
    );

    return renderShell({ left, right, footer });
  }

  if (stage === "settings") {
    const left = (
      <div className="space-y-8">
        <div>
          <h2 className="text-lg font-bold text-white">Topics and question settings</h2>
          <p className="text-xs text-gray-400 mt-0.5">Pick topics from your papers and choose how many questions you want from each.</p>
        </div>

        <div className="space-y-1.5">
          <label className="text-[11px] font-bold text-gray-300 uppercase tracking-wider block">
            What is this exam for? <span className="font-normal normal-case tracking-normal text-gray-500">(optional)</span>
          </label>
          <Textarea
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder="e.g. Board-style numerical problems, or a quick check of the basic concepts"
            className="min-h-0 resize-none rounded-none border-0 border-b border-white/20 bg-transparent px-0 shadow-none text-white placeholder:text-zinc-500 focus:border-orange-500 focus-visible:border-orange-500"
          />
          <p className="text-[11px] text-gray-500">When a topic has more matching questions than you need, this helps choose the best fit.</p>
        </div>

        <div className="space-y-3">
          <h3 className="text-[11px] font-bold text-gray-300 uppercase tracking-wider">Topics in your papers</h3>
          {loadingTopics ? (
            <div className="flex items-center gap-2 text-xs text-gray-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading the topics in your papers...
            </div>
          ) : visibleTopics.length === 0 ? (
            <p className="text-xs italic text-gray-500">
              {paperTopics.length === 0 ? "No topics were found in these papers. Type your own below." : `None of the topics have ${questionType === "mcq" ? "multiple-choice" : "descriptive"} questions.`}
            </p>
          ) : (
            <>
              <div className="relative">
                <Search className="pointer-events-none absolute left-0 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
                <Input value={topicSearch} onChange={(e) => setTopicSearch(e.target.value)} placeholder="Search topics" className={cn(fieldClass, "pl-6")} />
              </div>
              {shownTopics.length === 0 ? (
                <p className="text-xs italic text-gray-500">No topics match your search.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {shownTopics.map((t) => {
                    const isPicked = pickedKeys.has(topicKey(t.topic));
                    return (
                      <button
                        key={t.topic}
                        type="button"
                        onClick={() => togglePaperTopic(t)}
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors",
                          isPicked ? "border-orange-500/60 bg-orange-500/15 text-orange-200" : "border-white/10 text-gray-300 hover:border-orange-500/40"
                        )}
                      >
                        {isPicked && <Check className="h-3 w-3" />}
                        {t.topic}
                        <span className="text-gray-500">{availableIn(t)}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>

        <div className="space-y-2">
          <h3 className="text-[11px] font-bold text-gray-300 uppercase tracking-wider">Your topics</h3>
          {picked.length === 0 ? (
            <p className="text-xs italic text-gray-500">Tap a topic above, or type your own, to start.</p>
          ) : (
            <ul className="divide-y divide-white/5">
              {picked.map((row) => (
                <PickedTopicRow
                  key={topicKey(row.topic)}
                  row={row}
                  available={availableFor(row)}
                  onCount={(n) => setPickedCount(row.topic, n)}
                  onRemove={() => setPicked((prev) => prev.filter((p) => topicKey(p.topic) !== topicKey(row.topic)))}
                />
              ))}
            </ul>
          )}
          <OwnTopicInput onAdd={addOwnTopic} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <label className="space-y-1">
            <span className="text-[11px] font-bold text-gray-300 uppercase tracking-wider block">Type</span>
            <select value={questionType} onChange={(e) => changeQuestionType(e.target.value as QuestionType)} className={selectClass}>
              <option value="mcq">MCQ</option>
              <option value="descriptive">Descriptive</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-[11px] font-bold text-gray-300 uppercase tracking-wider block">Marks each</span>
            <Input type="number" min={1} value={marks} onChange={(e) => setMarks(e.target.value)} className={fieldClass} />
          </label>
        </div>
      </div>
    );

    const right = (
      <div className="space-y-4">
        <div className="rounded-xl border border-white/10 bg-[#0f0f11] p-4 space-y-2">
          <h3 className="text-xs font-bold text-gray-300 uppercase tracking-wider">Drawing from</h3>
          <ul className="space-y-1.5">
            {selectedDocs.map((d) => (
              <li key={d.id} className="flex items-center gap-2 text-xs text-gray-200">
                <FileText className="h-3.5 w-3.5 text-gray-500 shrink-0" />
                <span className="truncate">{d.title}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <StatTile label="Topics" value={picked.length} tone="text-orange-300" />
          <StatTile label="Questions" value={totalQuestions} tone="text-purple-300" />
        </div>
        <StatTile label="Total marks" value={totalQuestions * (Number(marks) || 0)} tone="text-emerald-400" />
        <p className="text-[11px] text-gray-500 leading-relaxed">
          Questions are taken word for word from the papers. If the papers don&apos;t have enough for a topic, you&apos;ll get fewer than requested.
        </p>
      </div>
    );

    const footer = (
      <>
        <Button variant="ghost" onClick={() => setStage("papers")} className={ghostButton}>
          <ArrowLeft className="h-4 w-4 mr-1.5" /> Previous
        </Button>
        <Button onClick={handleRetrieve} className={primaryButton}>
          <Sparkles className="h-4 w-4 mr-2" /> Find Questions
        </Button>
      </>
    );

    return renderShell({ left, right, footer });
  }

  const left = isRetrieving ? (
    <div className="flex flex-col items-center justify-center py-24 space-y-4">
      <div className="w-14 h-14 rounded-full border-4 border-purple-500/20 border-t-purple-500 animate-spin" />
      <p className="text-sm font-bold text-white">{goal.trim() ? "Finding the best matches for your goal..." : "Finding matching questions..."}</p>
    </div>
  ) : (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold text-white">Preview questions</h2>
        <p className="text-xs text-gray-400 mt-0.5">Remove any you don&apos;t want. The rest are added to the exam exactly as shown.</p>
      </div>
      {(results ?? []).map((group) => (
        <div key={group.topic} className="space-y-2.5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-bold text-white">
              {group.topic}
            </h3>
            <span className="text-[11px] text-gray-400">
              {group.questions.length} of {group.allocatedQuestions} found
            </span>
          </div>
          {group.questions.length === 0 ? (
            <p className="text-xs italic text-gray-500 rounded-xl border border-dashed border-white/10 p-4">The selected papers had no questions matching this topic.</p>
          ) : (
            group.questions.map((q, i) => (
              <RetrievedQuestion
                key={q.id}
                q={q}
                index={i}
                documentTitle={documentTitles[q.source.documentId] ?? "source paper"}
                removed={removedIds.has(q.id)}
                onToggle={() =>
                  setRemovedIds((prev) => {
                    const next = new Set(prev);
                    if (next.has(q.id)) next.delete(q.id);
                    else next.add(q.id);
                    return next;
                  })
                }
              />
            ))
          )}
        </div>
      ))}
    </div>
  );

  const right = (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2.5">
        <StatTile label="Keeping" value={keptQuestions.length} tone="text-purple-300" />
        <StatTile label="Removed" value={removedIds.size} tone="text-gray-300" />
      </div>
      <StatTile label="Total marks" value={keptMarks} tone="text-emerald-400" />
      <p className="text-[11px] text-gray-500 leading-relaxed">
        After adding, you can edit any question or ask the Question Review Agent for changes.
      </p>
    </div>
  );

  const footer = (
    <>
      <Button variant="ghost" disabled={isRetrieving || isSaving} onClick={() => setStage("settings")} className={ghostButton}>
        <ArrowLeft className="h-4 w-4 mr-1.5" /> Previous
      </Button>
      <Button onClick={handleAddToExam} disabled={isRetrieving || isSaving || keptQuestions.length === 0} className={primaryButton}>
        {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : `Add ${keptQuestions.length} Question${keptQuestions.length === 1 ? "" : "s"} to Exam`}
      </Button>
    </>
  );

  return renderShell({ left, right, footer });
}
