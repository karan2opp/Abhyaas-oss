"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ArrowRight, Check, ChevronDown, FileText, Loader2, Plus, UploadCloud, X, Sparkles, AlertTriangle, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  listQuestionBankDocuments,
  uploadQuestionBankDocument,
  getPaperTopicTree,
  pickQuestionsFromPapers,
  PaperTopicTree,
  PickShortfall,
  QuestionBankDocument,
  GeneratedTopicGroup,
  GeneratedQuestion,
  QuestionType,
} from "@/services/questionBank.service";
import { remainingBySubtopic } from "@/lib/pyqMatching";
import { saveGeneratedExamService } from "@/app/teacher/exams/exam.service";
import type { WorkspaceParts } from "./QuestionBuilder";
import { StatTile, WizardNavButtons } from "./workspace";
import { SubtopicRow } from "./SubtopicRow";
import { ContentBlocksView, MarkdownCode, OptionValue } from "@/components/QuestionContentBlocks";
import ReactMarkdown from "react-markdown";
import { normalizeCodeBlocks } from "@/lib/markdown";
import { MATH_REMARK_PLUGINS, MATH_REHYPE_PLUGINS } from "@/lib/markdownMath";

export type PyqStage = "papers" | "topics" | "goal" | "preview";

// Until the questions are added to the exam, what the teacher has picked (papers, sections, topics and the questions
// found) lives only in this page, so a reload would start over. It is also kept in this browser, per exam, and cleared
// once the questions are added or the exam is discarded.
const progressKey = (examId: string) => `pyq-progress:${examId}`;
const PROGRESS_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
// Bumped when the saved shape changes. Progress saved by an older version of this screen is dropped, not misread.
const PROGRESS_VERSION = 3;

// Paper id -> subtopic key -> how many questions to take.
type Picks = Record<string, Record<string, number>>;

// One section of the exam: its own question type and marks, which of the exam's papers it takes questions from, and
// how many it takes from each subtopic.
type PyqSection = {
  id: string;
  name: string;
  questionType: QuestionType;
  marks: string;
  docIds: string[];
  picks: Picks;
};

type PyqProgress = {
  version: number;
  savedAt: number;
  stage: PyqStage;
  selectedDocIds: string[];
  sections: PyqSection[];
  openSectionId: string | null;
  goal: string;
  results: GeneratedTopicGroup[] | null;
  shortfalls: PickShortfall[];
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
    if (saved.version !== PROGRESS_VERSION || Date.now() - saved.savedAt > PROGRESS_MAX_AGE_MS) {
      clearPyqProgress(examId);
      return null;
    }
    return saved;
  } catch {
    return null;
  }
}

const MCQ_LETTERS = ["A", "B", "C", "D", "E", "F"];
const MAX_QUESTIONS = 100;

const fieldClass = "text-white placeholder:text-zinc-500 h-9 text-sm";
// The open list of a native select takes its colours from the options, so they are given the dark theme too (white
// text on the browser's white list would be invisible).
const selectClass =
  "w-full text-white h-9 text-sm rounded-none border-0 border-b border-white/20 bg-transparent px-0 transition-colors placeholder:text-zinc-500 focus:border-orange-500 focus:outline-none focus:ring-0 [color-scheme:dark] [&>option]:bg-[#18181b] [&>option]:text-white";
const primaryButton = "bg-purple-600 hover:bg-purple-700 text-white h-10 px-6 font-bold text-sm rounded-xl shadow-lg shadow-purple-950/40";
const labelClass = "text-[11px] font-bold text-gray-300 uppercase tracking-wider block";

const countIn = (picks: Record<string, number> | undefined) => Object.values(picks ?? {}).reduce((n, c) => n + c, 0);
const sectionCount = (section: PyqSection) => Object.values(section.picks).reduce((n, byKey) => n + countIn(byKey), 0);
const typeLabel = (type: QuestionType) => (type === "mcq" ? "MCQ" : "Descriptive");
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
// A paper's topic tree depends on the question type, so trees are kept per type and paper.
const treeKey = (type: QuestionType, docId: string) => `${type}|${docId}`;

// "Section A", "Section B", ...: the first letter no section is using yet.
function nextSectionName(sections: PyqSection[]) {
  const used = new Set(sections.map((s) => s.name.trim().toLowerCase()));
  for (let i = 0; i < 26; i++) {
    const name = `Section ${String.fromCharCode(65 + i)}`;
    if (!used.has(name.toLowerCase())) return name;
  }
  return `Section ${sections.length + 1}`;
}

const makeSection = (sections: PyqSection[], docIds: string[]): PyqSection => ({
  id: Math.random().toString(36).slice(2, 10),
  name: nextSectionName(sections),
  questionType: "mcq",
  marks: "2",
  docIds,
  picks: {},
});

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
          <span className="border border-white/10 bg-white/5 px-2.5 py-1 rounded-md text-gray-300 text-[10px] font-bold">Marks: {q.marks}</span>
        </div>

        <div className="text-white text-[15px] leading-relaxed mb-6 font-medium prose prose-invert max-w-none pr-20">
          <ReactMarkdown
            remarkPlugins={MATH_REMARK_PLUGINS}
            rehypePlugins={MATH_REHYPE_PLUGINS}
            components={{
              pre: ({ children }) => (
                <div className="my-5 rounded-xl overflow-hidden border border-white/10 bg-[#09090b] keep-dark shadow-2xl">
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
            {q.topic} · from {documentTitle}
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
  const [stage, setStage] = useState<PyqStage>(saved ? (saved.stage === "preview" && !saved.results ? "goal" : saved.stage) : "papers");
  const [documents, setDocuments] = useState<QuestionBankDocument[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>(saved?.selectedDocIds ?? []);

  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadTitle, setUploadTitle] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // A section holds one type of question, so each section chooses its type first and every count shown in it is for
  // that type.
  const [sections, setSections] = useState<PyqSection[]>(saved?.sections ?? []);
  const [openSectionId, setOpenSectionId] = useState<string | null>(saved?.openSectionId ?? null);
  const [goal, setGoal] = useState(saved?.goal ?? "");

  // Topic trees by treeKey, kept once read: a paper's topics don't change.
  const [trees, setTrees] = useState<Record<string, PaperTopicTree>>({});
  const [treeErrors, setTreeErrors] = useState<Record<string, string>>({});
  const fetchingTrees = useRef(new Set<string>());
  // The open paper in a section ("sectionId|docId").
  const [openPaper, setOpenPaper] = useState<string | null>(null);
  // Several broad topics can be open at once, so the teacher can watch one count change while picking from another.
  const [openBroads, setOpenBroads] = useState<string[]>([]);

  const [isRetrieving, setIsRetrieving] = useState(false);
  const [results, setResults] = useState<GeneratedTopicGroup[] | null>(saved?.results ?? null);
  const [shortfalls, setShortfalls] = useState<PickShortfall[]>(saved?.shortfalls ?? []);
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set(saved?.removedIds ?? []));
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    onStageChange?.(stage);
  }, [stage]);

  useEffect(() => {
    try {
      const progress: PyqProgress = {
        version: PROGRESS_VERSION,
        savedAt: Date.now(),
        stage,
        selectedDocIds,
        sections,
        openSectionId,
        goal,
        results,
        shortfalls,
        removedIds: [...removedIds],
      };
      localStorage.setItem(progressKey(examId), JSON.stringify(progress));
    } catch {
      // Not remembering is harmless.
    }
  }, [examId, stage, selectedDocIds, sections, openSectionId, goal, results, shortfalls, removedIds]);

  // The exam starts with one section using every chosen paper. A paper chosen later is offered to every section (the
  // teacher can untick it where it doesn't belong), and a paper no longer chosen is taken out, with its picks.
  const selectedKey = selectedDocIds.join(",");
  const previousSelected = useRef<string[] | null>(null);
  useEffect(() => {
    const before = previousSelected.current;
    previousSelected.current = selectedDocIds;
    if (sections.length === 0) {
      if (selectedDocIds.length === 0) return;
      const first = makeSection([], [...selectedDocIds]);
      setSections([first]);
      setOpenSectionId(first.id);
      setOpenPaper(`${first.id}|${selectedDocIds[0]}`);
      return;
    }
    const added = before ? selectedDocIds.filter((id) => !before.includes(id)) : [];
    setSections((prev) =>
      prev.map((s) => {
        const docIds = selectedDocIds.filter((id) => s.docIds.includes(id) || added.includes(id));
        const picks = Object.fromEntries(Object.entries(s.picks).filter(([docId]) => docIds.includes(docId)));
        return { ...s, docIds: docIds.length > 0 ? docIds : [...selectedDocIds], picks };
      })
    );
  }, [selectedKey]);

  // The topic trees the sections need (each section's papers, for its question type), read once each.
  const needsTrees = stage === "topics" || stage === "goal";
  const neededTrees = needsTrees ? [...new Set(sections.flatMap((s) => s.docIds.map((docId) => treeKey(s.questionType, docId))))] : [];
  const treesPending = neededTrees.some((key) => !trees[key] && !treeErrors[key]);
  useEffect(() => {
    const missing = neededTrees.filter((key) => !trees[key] && !treeErrors[key] && !fetchingTrees.current.has(key));
    if (missing.length === 0) return;
    for (const key of missing) fetchingTrees.current.add(key);
    void Promise.all(
      missing.map((key) => {
        const [type, docId] = key.split("|") as [QuestionType, string];
        return getPaperTopicTree(docId, type).then(
          (tree) => ({ key, tree, error: null as string | null }),
          (err: any) => ({ key, tree: null, error: (err?.response?.data?.message as string) || "Could not read this paper's topics" })
        );
      })
    ).then((loaded) => {
      for (const { key } of loaded) fetchingTrees.current.delete(key);
      const loadedTrees = Object.fromEntries(loaded.filter((l) => l.tree).map((l) => [l.key, l.tree!]));
      setTrees((prev) => ({ ...prev, ...loadedTrees }));
      setTreeErrors((prev) => ({ ...prev, ...Object.fromEntries(loaded.filter((l) => l.error).map((l) => [l.key, l.error!])) }));
      // A pick for a subtopic the paper no longer has can't be filled.
      setSections((prev) =>
        prev.map((s) => {
          const picks: Picks = {};
          for (const [docId, byKey] of Object.entries(s.picks)) {
            const tree = loadedTrees[treeKey(s.questionType, docId)];
            if (!tree) {
              picks[docId] = byKey;
              continue;
            }
            const known = new Set(tree.broadTopics.flatMap((b) => b.subtopics.map((sub) => sub.key)));
            const kept = Object.fromEntries(Object.entries(byKey).filter(([key, n]) => known.has(key) && n > 0));
            if (Object.keys(kept).length > 0) picks[docId] = kept;
          }
          return { ...s, picks };
        })
      );
    });
  }, [neededTrees.join(",")]);

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
    const timer = setInterval(() => void loadDocuments(), 2500);
    return () => clearInterval(timer);
  }, [hasProcessing]);

  const documentTitles = useMemo(() => Object.fromEntries(documents.map((d) => [d.id, d.title])), [documents]);
  const selectedDocs = documents.filter((d) => selectedDocIds.includes(d.id));
  const totalQuestions = sections.reduce((n, s) => n + sectionCount(s), 0);
  const totalMarks = sections.reduce((n, s) => n + sectionCount(s) * (Number(s.marks) || 0), 0);

  // How many more each subtopic can still give, per question type and paper, given every section's picks. The
  // sections share one pool, so a question picked in one section is no longer there for the others.
  const remaining = useMemo(() => {
    const combined: Record<string, Record<string, number>> = {};
    for (const s of sections) {
      for (const [docId, byKey] of Object.entries(s.picks)) {
        const forTree = (combined[treeKey(s.questionType, docId)] ??= {});
        for (const [key, n] of Object.entries(byKey)) forTree[key] = (forTree[key] ?? 0) + n;
      }
    }
    const out: Record<string, Record<string, number>> = {};
    for (const [key, tree] of Object.entries(trees)) out[key] = remainingBySubtopic(tree.questions, combined[key] ?? {});
    return out;
  }, [trees, sections]);

  // A section's picks with their names, in tree order, for the summary and the request.
  const pickListOf = (s: PyqSection) =>
    s.docIds.flatMap((docId) =>
      (trees[treeKey(s.questionType, docId)]?.broadTopics ?? []).flatMap((broad) =>
        broad.subtopics
          .filter((sub) => (s.picks[docId]?.[sub.key] ?? 0) > 0)
          .map((sub) => ({ docId, key: sub.key, broad: broad.name, name: sub.name, count: s.picks[docId]![sub.key]! }))
      )
    );

  const updateSection = (id: string, change: (s: PyqSection) => PyqSection) => setSections((prev) => prev.map((s) => (s.id === id ? change(s) : s)));

  const setPickCount = (sectionId: string, docId: string, key: string, count: number) =>
    updateSection(sectionId, (s) => {
      const forPaper = { ...(s.picks[docId] ?? {}) };
      if (count > 0) forPaper[key] = count;
      else delete forPaper[key];
      const picks = { ...s.picks, [docId]: forPaper };
      if (Object.keys(forPaper).length === 0) delete picks[docId];
      return { ...s, picks };
    });

  // Switching between MCQ and descriptive changes which questions exist at all, so the section's picks start over.
  const changeSectionType = (s: PyqSection, type: QuestionType) => {
    if (type === s.questionType) return;
    if (sectionCount(s) > 0) toast.info(`${s.name || "Section"}: picks cleared, the topics are counted again for the new question type.`);
    updateSection(s.id, (x) => ({ ...x, questionType: type, picks: {} }));
  };

  const toggleSectionPaper = (s: PyqSection, docId: string) => {
    if (s.docIds.includes(docId)) {
      if (s.docIds.length === 1) return toast.error("A section needs at least one paper");
      updateSection(s.id, (x) => {
        const picks = { ...x.picks };
        delete picks[docId];
        return { ...x, docIds: x.docIds.filter((d) => d !== docId), picks };
      });
    } else {
      updateSection(s.id, (x) => ({ ...x, docIds: selectedDocIds.filter((d) => d === docId || x.docIds.includes(d)) }));
    }
  };

  const openSection = (s: PyqSection) => {
    setOpenSectionId(s.id);
    if (s.docIds[0]) setOpenPaper(`${s.id}|${s.docIds[0]}`);
  };

  const addSection = () => {
    const section = makeSection(sections, [...selectedDocIds]);
    setSections((prev) => [...prev, section]);
    openSection(section);
  };

  const removeSection = (s: PyqSection) => {
    const count = sectionCount(s);
    if (count > 0 && !confirm(`Remove ${s.name || "this section"} and its ${plural(count, "picked question")}?`)) return;
    setSections((prev) => prev.filter((x) => x.id !== s.id));
    if (openSectionId === s.id) setOpenSectionId(null);
  };

  const sectionName = (id: string | undefined) => sections.find((s) => s.id === id)?.name || "Section";
  const groupsOf = (s: PyqSection) => (results ?? []).filter((g) => g.section === s.id);
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

  const goToGoal = () => {
    if (totalQuestions === 0) return toast.error("Pick at least one question");
    for (const s of sections) {
      if (sectionCount(s) === 0) continue;
      if (!s.name.trim()) return toast.error("Give every section a name");
      const marksEach = Number(s.marks);
      if (!marksEach || marksEach < 1) return toast.error(`${s.name}: marks per question must be at least 1`);
    }
    if (totalQuestions > MAX_QUESTIONS) return toast.error(`You can ask for at most ${MAX_QUESTIONS} questions at once`);
    setStage("goal");
  };

  const handleRetrieve = async () => {
    const filled = sections.filter((s) => sectionCount(s) > 0);
    if (filled.length === 0) {
      toast.error("Pick at least one question");
      setStage("topics");
      return;
    }

    setIsRetrieving(true);
    setStage("preview");
    try {
      // The sections of one question type are filled in one request, from one pool, so no question lands in two of
      // them. MCQ and descriptive questions are different questions, so each type is asked for on its own.
      const types = [...new Set(filled.map((s) => s.questionType))];
      const found = await Promise.all(
        types.map((type) =>
          pickQuestionsFromPapers({
            picks: filled
              .filter((s) => s.questionType === type)
              .flatMap((s) => pickListOf(s).map((p) => ({ documentId: p.docId, subtopic: p.key, count: p.count, section: s.id }))),
            goal: goal.trim() || undefined,
            questionType: type,
            marks: 1,
          })
        )
      );
      // Each question carries its own section's marks.
      const marksOf = new Map(filled.map((s) => [s.id, Number(s.marks)]));
      setResults(found.flatMap((f) => f.groups).map((g) => ({ ...g, questions: g.questions.map((q) => ({ ...q, marks: marksOf.get(g.section ?? "") ?? q.marks })) })));
      setShortfalls(found.flatMap((f) => f.shortfalls));
      setRemovedIds(new Set());
    } catch (err: any) {
      toast.error(err?.response?.data?.message || err?.message || "Could not retrieve questions");
      setStage("goal");
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
      // One exam section per section built here, each split into groups by broad topic. Sections left empty are skipped.
      const examSections = sections
        .map((s) => ({
          name: s.name.trim() || "Section",
          blocks: groupsOf(s)
            .map((g) => {
              const questions = g.questions
                .filter((q) => !removedIds.has(q.id))
                .map((q) =>
                  q.type === "mcq"
                    ? {
                        type: "mcq",
                        description: q.question_text,
                        marks: q.marks,
                        topic: g.topic,
                        subtopic: q.topic,
                        contentBlocks: q.content_blocks ?? [],
                        options: (q.options ?? []).map((opt, i) => ({ value: opt, isCode: false, isCorrect: MCQ_LETTERS[i] === q.correct_option })),
                      }
                    : { type: "descriptive", description: q.question_text, marks: q.marks, topic: g.topic, subtopic: q.topic, contentBlocks: q.content_blocks ?? [] }
                );
              return {
                name: g.topic,
                subject: "",
                question_type: s.questionType,
                total_marks: questions.reduce((sum, q) => sum + (Number(q.marks) || 0), 0),
                instructions: [],
                questions,
              };
            })
            .filter((b) => b.questions.length > 0),
        }))
        .filter((s) => s.blocks.length > 0);

      // The papers are kept on the exam, so "Add topic" in the editor later offers their topics.
      await saveGeneratedExamService({ examId, sourceDocumentIds: selectedDocIds, sections: examSections });
      toast.success(`${keptQuestions.length} question(s) added to the exam`);
      clearPyqProgress(examId);
      onSuccess();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || err?.message || "Failed to add questions");
    } finally {
      setIsSaving(false);
    }
  };

  // The running list of picks, section by section, with a quick way to drop one.
  const picksSummary = (
    <div className="space-y-2">
      <h3 className="text-[11px] font-bold text-gray-300 uppercase tracking-wider">Your picks</h3>
      {totalQuestions === 0 ? (
        <p className="text-xs italic text-gray-500">Nothing picked yet. Open a section, then a topic, and use + to add questions.</p>
      ) : (
        <ul className="space-y-4">
          {sections
            .filter((s) => sectionCount(s) > 0)
            .map((s) => (
              <li key={s.id} className="space-y-1">
                <p className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-xs font-bold text-white">{s.name.trim() || "Untitled section"}</span>
                  <span className="shrink-0 text-[11px] text-gray-500">
                    {typeLabel(s.questionType)} · {plural(sectionCount(s), "question")} · {sectionCount(s) * (Number(s.marks) || 0)} marks
                  </span>
                </p>
                <ul>
                  {pickListOf(s).map((p) => (
                    <li key={`${p.docId}|${p.key}`} className="flex items-center justify-between gap-2 border-b border-white/5 py-1.5 text-xs">
                      <span className="min-w-0 text-gray-200">
                        <span className="text-gray-500">{p.broad} → </span>
                        {p.name}
                        {s.docIds.length > 1 && <span className="block truncate text-[10px] text-gray-500">{documentTitles[p.docId] ?? "Paper"}</span>}
                      </span>
                      <span className="flex shrink-0 items-center gap-1">
                        <span className="font-bold tabular-nums text-orange-300">×{p.count}</span>
                        <button
                          type="button"
                          aria-label={`Remove ${p.name} from ${s.name}`}
                          onClick={() => setPickCount(s.id, p.docId, p.key, 0)}
                          className="flex h-7 w-7 items-center justify-center rounded-md text-gray-500 hover:bg-red-500/10 hover:text-red-400"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
        </ul>
      )}
    </div>
  );

  const totalsTiles = (
    <div className="grid grid-cols-2 gap-2.5">
      <StatTile label="Questions" value={totalQuestions} tone="text-purple-300" />
      <StatTile label="Total marks" value={totalMarks} tone="text-emerald-400" />
    </div>
  );

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
                    "flex min-w-0 items-center gap-3 rounded-xl border p-3.5 transition-colors",
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
                    {(doc.status === "pending" || doc.status === "processing") && (
                      <div className="mt-1.5 space-y-1">
                        <div className="h-1 w-full overflow-hidden rounded-full bg-white/10">
                          <div className="h-full rounded-full bg-amber-400 transition-[width] duration-700" style={{ width: `${Math.max(doc.progress ?? 0, 3)}%` }} />
                        </div>
                        <p className="text-[11px] text-amber-300/80">{doc.progressLabel || (doc.status === "pending" ? "Waiting to start" : "Processing")}</p>
                      </div>
                    )}
                  </div>
                  <span
                    className={cn(
                      "text-[11px] font-semibold shrink-0",
                      ready && "text-gray-400",
                      (doc.status === "pending" || doc.status === "processing") && "text-amber-400",
                      doc.status === "failed" && "text-red-400"
                    )}
                  >
                    {ready ? `${doc.totalChunks} questions` : doc.status === "failed" ? "Failed" : `${doc.progress ?? 0}%`}
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
        <WizardNavButtons onPrevious={onBack} />
        <Button
          onClick={() => (selectedDocIds.length === 0 ? toast.error("Select at least one paper") : setStage("topics"))}
          className={primaryButton}
        >
          Next <ArrowRight className="h-4 w-4 ml-2" />
        </Button>
      </>
    );

    return renderShell({ left, right, footer });
  }

  if (stage === "topics") {
    // The papers and topics of one section.
    const sectionBody = (s: PyqSection) => (
      <div className="space-y-6 pb-5">
        <label className="block space-y-1">
          <span className={labelClass}>Section name</span>
          <Input value={s.name} maxLength={100} onChange={(e) => updateSection(s.id, (x) => ({ ...x, name: e.target.value }))} placeholder="e.g. Section A" className={fieldClass} />
        </label>

        <div className="grid grid-cols-2 gap-4">
          <label className="space-y-1">
            <span className={labelClass}>Question type</span>
            <select value={s.questionType} onChange={(e) => changeSectionType(s, e.target.value as QuestionType)} className={selectClass}>
              <option value="mcq">MCQ</option>
              <option value="descriptive">Descriptive</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className={labelClass}>Marks each</span>
            <Input type="number" min={1} value={s.marks} onChange={(e) => updateSection(s.id, (x) => ({ ...x, marks: e.target.value }))} className={fieldClass} />
          </label>
        </div>

        {selectedDocIds.length > 1 && (
          <div className="space-y-2">
            <span className={labelClass}>Papers</span>
            <div className="flex flex-wrap gap-2">
              {selectedDocIds.map((docId) => {
                const on = s.docIds.includes(docId);
                return (
                  <button
                    key={docId}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleSectionPaper(s, docId)}
                    className={cn(
                      "inline-flex max-w-full items-center gap-1.5 rounded-full border py-1 pl-2 pr-3 text-xs transition-colors",
                      on ? "border-orange-500/50 bg-orange-500/10 text-orange-200" : "border-white/25 text-gray-300 hover:bg-white/5"
                    )}
                  >
                    {on ? <Check className="h-3.5 w-3.5 shrink-0" /> : <Plus className="h-3.5 w-3.5 shrink-0" />}
                    <span className="truncate">{documentTitles[docId] ?? "Paper"}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <ul className="divide-y divide-white/10 border-y border-white/10">
          {s.docIds.map((docId) => {
            const key = treeKey(s.questionType, docId);
            const tree = trees[key];
            const error = treeErrors[key];
            const paperId = `${s.id}|${docId}`;
            const isOpen = openPaper === paperId;
            const pickedHere = countIn(s.picks[docId]);
            return (
              <li key={docId}>
                <button
                  type="button"
                  onClick={() => setOpenPaper(isOpen ? null : paperId)}
                  aria-expanded={isOpen}
                  className="flex w-full items-center gap-3 py-3.5 text-left"
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-purple-500/15">
                    <FileText className="h-3.5 w-3.5 text-purple-300" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-gray-100">{documentTitles[docId] ?? "Paper"}</span>
                    <span className="block text-[11px] text-gray-400">
                      {tree ? plural(tree.questions.length, `${s.questionType === "mcq" ? "MCQ" : "descriptive"} question`) : error ? "Could not load" : "Loading..."}
                      {pickedHere > 0 ? ` · ${pickedHere} picked` : ""}
                    </span>
                  </span>
                  <ChevronDown className={cn("h-4 w-4 shrink-0 text-gray-400 transition-transform", isOpen && "rotate-180")} />
                </button>

                {isOpen && (
                  <div className="pb-3">
                    {error ? (
                      <p className="text-xs text-red-400">{error}</p>
                    ) : !tree ? (
                      <p className="flex items-center gap-2 text-xs text-gray-400">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading topics...
                      </p>
                    ) : tree.broadTopics.length === 0 ? (
                      <p className="text-xs italic text-gray-500">This paper has no {s.questionType === "mcq" ? "multiple-choice" : "descriptive"} questions.</p>
                    ) : (
                      <>
                        {!tree.grouped && (
                          <p className="mb-2 text-[11px] text-gray-400">This paper&apos;s topics haven&apos;t been grouped into chapters yet, so they are listed together.</p>
                        )}
                        {/* Broad topics sit one step in from their paper, on a purple guide line. */}
                        <ul className={cn("divide-y divide-white/10", tree.broadTopics.length > 1 && "ml-3 border-l border-purple-500/50 pl-4")}>
                          {tree.broadTopics.map((broad) => {
                            const broadId = `${paperId}|${broad.name}`;
                            const broadOpen = openBroads.includes(broadId) || tree.broadTopics.length === 1;
                            const pickedInBroad = broad.subtopics.reduce((n, sub) => n + (s.picks[docId]?.[sub.key] ?? 0), 0);
                            return (
                              <li key={broadId}>
                                {tree.broadTopics.length > 1 && (
                                  <button
                                    type="button"
                                    onClick={() => setOpenBroads((prev) => (broadOpen ? prev.filter((b) => b !== broadId) : [...prev, broadId]))}
                                    aria-expanded={broadOpen}
                                    className="flex w-full items-center gap-3 py-3 text-left"
                                  >
                                    <span className="min-w-0 flex-1">
                                      <span className="block truncate text-sm font-semibold text-white">{broad.name}</span>
                                      <span className="block text-[11px] text-gray-400">
                                        {plural(broad.total, "question")} · {plural(broad.subtopics.length, "subtopic")}
                                      </span>
                                    </span>
                                    {pickedInBroad > 0 && (
                                      <span className="shrink-0 rounded-full bg-orange-500/15 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-orange-300">{pickedInBroad} picked</span>
                                    )}
                                    <ChevronDown className={cn("h-4 w-4 shrink-0 text-gray-400 transition-transform", broadOpen && "rotate-180")} />
                                  </button>
                                )}
                                {broadOpen && (
                                  <ul className={cn("divide-y divide-white/10", tree.broadTopics.length > 1 && "mb-3 ml-1 border-l border-white/25 pl-4")}>
                                    {broad.subtopics.map((sub) => (
                                      <SubtopicRow
                                        key={sub.key}
                                        name={sub.name}
                                        count={s.picks[docId]?.[sub.key] ?? 0}
                                        remaining={remaining[key]?.[sub.key] ?? 0}
                                        onCount={(n) => setPickCount(s.id, docId, sub.key, n)}
                                      />
                                    ))}
                                  </ul>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      </>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    );

    const left = (
      <div className="space-y-6">
        <div>
          <h2 className="text-lg font-bold text-white">Build sections</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            Each section has one question type. Open a section, choose the papers it uses, then pick how many questions to take from each topic.
          </p>
        </div>

        <ul className="divide-y divide-white/10 border-y border-white/10">
          {sections.map((s, index) => {
            const open = openSectionId === s.id;
            const count = sectionCount(s);
            return (
              <li key={s.id}>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => (open ? setOpenSectionId(null) : openSection(s))}
                    aria-expanded={open}
                    className="flex min-w-0 flex-1 items-center gap-3 py-4 text-left"
                  >
                    {/* A, B, C... by position, so sections stand apart from the papers and topics inside them. */}
                    <span
                      className={cn(
                        "flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-xs font-bold transition-colors",
                        open ? "bg-orange-500 text-black" : "bg-orange-500/15 text-orange-300"
                      )}
                    >
                      {index < 26 ? String.fromCharCode(65 + index) : index + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-base font-bold text-white">{s.name.trim() || "Untitled section"}</span>
                      <span className="block text-[11px] text-gray-400">
                        {typeLabel(s.questionType)} · {plural(Number(s.marks) || 0, "mark")} each
                      </span>
                    </span>
                    {count > 0 && (
                      <span className="shrink-0 rounded-full bg-orange-500/15 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-orange-300">{count} picked</span>
                    )}
                    <ChevronDown className={cn("h-4 w-4 shrink-0 text-gray-400 transition-transform", open && "rotate-180")} />
                  </button>
                  {sections.length > 1 && (
                    <button
                      type="button"
                      aria-label={`Remove ${s.name || "section"}`}
                      onClick={() => removeSection(s)}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-red-500/10 hover:text-red-400"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
                {/* An orange line down the open section's edge shows where it starts and ends. */}
                {open && <div className="ml-3.5 border-l-2 border-orange-500/70 pl-4 sm:pl-5">{sectionBody(s)}</div>}
              </li>
            );
          })}
        </ul>

        <button type="button" onClick={addSection} className="inline-flex items-center gap-1.5 text-sm font-semibold text-orange-400 transition-colors hover:text-orange-300">
          <Plus className="h-4 w-4" /> Add section
        </button>

        {/* On a phone the right-hand panel sits far below, so the picks are listed here too. */}
        <div className="lg:hidden">{picksSummary}</div>
      </div>
    );

    const right = (
      <div className="space-y-4">
        <div className="hidden lg:block">{picksSummary}</div>
        {totalsTiles}
        <p className="text-[11px] text-gray-400 leading-relaxed">
          A question can belong to two topics, but it is only ever used once in the exam. Picking it under one topic or section can lower the count elsewhere.
        </p>
      </div>
    );

    const footer = (
      <>
        <WizardNavButtons onPrevious={() => setStage("papers")} />
        <Button onClick={goToGoal} className={primaryButton}>
          Next <ArrowRight className="h-4 w-4 ml-2" />
        </Button>
      </>
    );

    return renderShell({ left, right, footer });
  }

  if (stage === "goal") {
    const left = (
      <div className="space-y-8">
        <div>
          <h2 className="text-lg font-bold text-white">What is this exam for?</h2>
          <p className="text-xs text-gray-400 mt-0.5">Optional. When a topic has more questions than you picked, this decides which ones fit best.</p>
        </div>
        <Textarea
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          rows={3}
          maxLength={500}
          placeholder="e.g. Board-style numerical problems, or a quick check of the basic concepts"
          className="min-h-0 resize-none rounded-none border-0 border-b border-white/20 bg-transparent px-0 shadow-none text-white placeholder:text-zinc-500 focus:border-orange-500 focus-visible:border-orange-500"
        />
        <div className="lg:hidden">{picksSummary}</div>
      </div>
    );

    const right = (
      <div className="space-y-4">
        <div className="hidden lg:block">{picksSummary}</div>
        {totalsTiles}
        <p className="text-[11px] text-gray-500 leading-relaxed">Questions are taken word for word from the papers.</p>
      </div>
    );

    const footer = (
      <>
        <WizardNavButtons onPrevious={() => setStage("topics")} />
        <Button onClick={handleRetrieve} disabled={treesPending} className={primaryButton}>
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
    <div className="space-y-8">
      <div>
        <h2 className="text-lg font-bold text-white">Preview questions</h2>
        <p className="text-xs text-gray-400 mt-0.5">Remove any you don&apos;t want. The rest are added to the exam exactly as shown.</p>
      </div>
      {shortfalls.length > 0 && (
        <ul className="space-y-1.5 border-l-2 border-amber-500/60 pl-3">
          {shortfalls.map((s) => (
            <li key={`${s.section ?? ""}|${s.documentId}|${s.subtopic}`} className="text-xs text-amber-300">
              <span className="font-semibold">
                {sections.length > 1 ? `${sectionName(s.section)}: ` : ""}
                {s.broadTopic} → {s.subtopic}: {s.found} of {s.requested}.
              </span>{" "}
              <span className="text-amber-200/70">
                {s.reason === "shared"
                  ? "The rest were also needed by your other picks, and a question is only used once."
                  : `${documentTitles[s.documentId] ?? "The paper"} doesn't have more.`}
              </span>
            </li>
          ))}
        </ul>
      )}
      {sections
        .filter((s) => groupsOf(s).length > 0)
        .map((s) => {
          const groups = groupsOf(s);
          return (
            <section key={s.id} className="space-y-5">
              <div className="border-b border-white/10 pb-2">
                <h3 className="text-base font-bold text-white">{s.name.trim() || "Section"}</h3>
                <p className="text-[11px] text-gray-500">
                  {typeLabel(s.questionType)} · {plural(Number(s.marks) || 0, "mark")} each
                </p>
              </div>
              {groups.map((group, groupIndex) => (
                <div key={`${s.id}|${group.topic}`} className="space-y-2.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h4 className="text-sm font-bold text-white">{group.topic}</h4>
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
                        // Numbered within the section, as the exam numbers them.
                        index={groups.slice(0, groupIndex).reduce((n, g) => n + g.questions.length, 0) + i}
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
            </section>
          );
        })}
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
        After adding, you can still edit any question yourself.
      </p>
    </div>
  );

  const footer = (
    <>
      <WizardNavButtons onPrevious={() => setStage("goal")} previousDisabled={isRetrieving || isSaving} />
      <Button onClick={handleAddToExam} disabled={isRetrieving || isSaving || keptQuestions.length === 0} className={primaryButton}>
        {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : `Add ${keptQuestions.length} Question${keptQuestions.length === 1 ? "" : "s"} to Exam`}
      </Button>
    </>
  );

  return renderShell({ left, right, footer });
}
