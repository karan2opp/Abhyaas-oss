"use client";

import React, { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Plus, Pencil, ListChecks, X, Check, Eye, Sparkles, FileText, Loader2, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  getAssignmentByIdService,
  updateAssignmentService,
  extendAssignmentService,
  createQuestionService,
  updateQuestionService,
  deleteQuestionService,
  getQuestionsService,
} from "@/app/teacher/assignments/assignment.service";
import { formatDateTime } from "@/lib/date";
import {
  listQuestionBankDocuments,
  generateQuestionsFromDocuments,
  QuestionBankDocument,
} from "@/services/questionBank.service";
import { listBooks, BookSummary as Book } from "@/services/books.service";
import { generateTopicQuestions } from "@/services/generationAgents.service";
import { DateTimeInput } from "@/components/DateTimeInput";

interface Assignment {
  id: string;
  title: string;
  instructions: string | null;
  totalMarks: number;
  startDate: string | null;
  dueDate: string | null;
  joinCode: string | null;
  seriesId: string | null;
  sequenceOrder: number | null;
  dayGap: number | null;
}

interface Option {
  id?: string;
  value: string;
  isCorrect: boolean;
}

interface Question {
  id: string;
  type: "mcq" | "descriptive";
  description: string;
  marks: number;
  modelAnswer: string | null;
  options: Option[];
}

const emptyOption = (): Option => ({ value: "", isCorrect: false });

export default function AssignmentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const assignmentId = params.assignmentId as string;
  const seriesId = searchParams.get("seriesId");

  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);

  const [questionDialogOpen, setQuestionDialogOpen] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState<Question | null>(null);
  const [qType, setQType] = useState<"mcq" | "descriptive">("descriptive");
  const [qDescription, setQDescription] = useState("");
  const [qMarks, setQMarks] = useState("5");
  const [qModelAnswer, setQModelAnswer] = useState("");
  const [qOptions, setQOptions] = useState<Option[]>([emptyOption(), emptyOption()]);
  const [savingQuestion, setSavingQuestion] = useState(false);

  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editStartDate, setEditStartDate] = useState("");
  const [editDueDate, setEditDueDate] = useState("");
  const [, setEditTotalMarks] = useState("0");
  const [savingAssignment, setSavingAssignment] = useState(false);

  const [extendDialogOpen, setExtendDialogOpen] = useState(false);
  const [extendDays, setExtendDays] = useState("2");
  const [extendMode, setExtendMode] = useState<"grow" | "shift">("grow");
  const [extendCascade, setExtendCascade] = useState(true);
  const [extending, setExtending] = useState(false);

  // ── AI Generation Pipelines Modal States ────────────────────────────────────
  const [aiDialogOpen, setAiDialogOpen] = useState(false);
  const [aiPipeline, setAiPipeline] = useState<"srijan" | "smriti" | "gyan">("srijan");
  const [aiTopic, setAiTopic] = useState("");
  const [aiType, setAiType] = useState<"mcq" | "descriptive">("mcq");
  const [aiCount, setAiCount] = useState("3");
  const [aiMarks, setAiMarks] = useState("5");
  const [aiInstructions, setAiInstructions] = useState("");
  const [isGeneratingAi, setIsGeneratingAi] = useState(false);

  // Smriti (Past Papers) states
  const [documents, setDocuments] = useState<QuestionBankDocument[]>([]);
  const [selectedDocId, setSelectedDocId] = useState("");

  // Gyan (Textbook) states
  const [books, setBooks] = useState<Book[]>([]);
  const [selectedBookId, setSelectedBookId] = useState("");

  const loadAll = async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      const [aRes, qRes] = await Promise.all([
        getAssignmentByIdService(assignmentId),
        getQuestionsService(assignmentId),
      ]);
      setAssignment(aRes.data);
      setQuestions(qRes.data || []);
    } catch {
      toast.error("Failed to load assignment");
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  useEffect(() => {
    if (assignmentId === "new") {
      router.replace(`/teacher/assignments/new`);
      return;
    }
    if (assignmentId) loadAll();
  }, [assignmentId, router]);

  useEffect(() => {
    if (aiDialogOpen) {
      listQuestionBankDocuments().then(setDocuments).catch(() => {});
      listBooks().then((res) => setBooks(res || [])).catch(() => {});
    }
  }, [aiDialogOpen]);

  const resetQuestionForm = () => {
    setEditingQuestion(null);
    setQType("descriptive");
    setQDescription("");
    setQMarks("5");
    setQModelAnswer("");
    setQOptions([emptyOption(), emptyOption()]);
  };

  const openCreateQuestion = () => {
    resetQuestionForm();
    setQuestionDialogOpen(true);
  };

  const openEditQuestion = (q: Question) => {
    setEditingQuestion(q);
    setQType(q.type);
    setQDescription(q.description);
    setQMarks(String(q.marks));
    setQModelAnswer(q.modelAnswer || "");
    setQOptions(q.options.length > 0 ? q.options : [emptyOption(), emptyOption()]);
    setQuestionDialogOpen(true);
  };

  const handleOptionChange = (idx: number, field: "value" | "isCorrect", value: string | boolean) => {
    setQOptions((prev) => prev.map((o, i) => (i === idx ? { ...o, [field]: value } : o)));
  };

  const handleSaveQuestion = async () => {
    if (qDescription.trim().length < 10) {
      toast.error("Question description must be at least 10 characters");
      return;
    }
    const marks = parseFloat(qMarks);
    if (!marks || marks < 0.5) {
      toast.error("Marks must be at least 0.5");
      return;
    }
    if (qType === "mcq") {
      const validOptions = qOptions.filter((o) => o.value.trim() !== "");
      if (validOptions.length < 2) {
        toast.error("MCQ needs at least 2 options");
        return;
      }
      if (!validOptions.some((o) => o.isCorrect)) {
        toast.error("MCQ needs at least one correct option");
        return;
      }
    }

    setSavingQuestion(true);
    try {
      if (editingQuestion) {
        await updateQuestionService(editingQuestion.id, {
          description: qDescription.trim(),
          marks,
          modelAnswer: qModelAnswer.trim() || undefined,
          options: qType === "mcq" ? qOptions.filter((o) => o.value.trim() !== "") : undefined,
        });
        toast.success("Question updated");
      } else {
        await createQuestionService({
          assignmentId,
          type: qType,
          description: qDescription.trim(),
          marks,
          modelAnswer: qModelAnswer.trim() || undefined,
          options: qType === "mcq" ? qOptions.filter((o) => o.value.trim() !== "") : undefined,
        });
        toast.success("Question added");
      }
      setQuestionDialogOpen(false);
      resetQuestionForm();
      await loadAll(false);
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Failed to save question");
    } finally {
      setSavingQuestion(false);
    }
  };

  const handleGenerateAiQuestions = async () => {
    if (!aiTopic.trim()) {
      toast.error("Topic / Subject is required");
      return;
    }
    const count = parseInt(aiCount);
    const marks = parseFloat(aiMarks);
    if (!count || count < 1 || count > 10) {
      toast.error("Question count must be between 1 and 10");
      return;
    }

    setIsGeneratingAi(true);
    try {
      if (aiPipeline === "srijan" || aiPipeline === "gyan") {
        const output = await generateTopicQuestions({
          subject: assignment?.title || aiTopic.trim(),
          question_type: aiType,
          marks,
          topic: aiTopic.trim(),
          subtopics: [{ name: aiTopic.trim(), count }],
          globalInstructions: aiInstructions.trim() ? [aiInstructions.trim()] : [],
          topicInstructions: [],
        });

        for (const q of output.questions) {
          const MCQ_LETTERS = ["A", "B", "C", "D"];
          await createQuestionService({
            assignmentId,
            type: q.type,
            description: q.question_text,
            marks: q.marks || marks,
            options: q.type === "mcq" && q.options
              ? q.options.map((opt, i) => ({ value: opt.text, isCorrect: MCQ_LETTERS[i] === q.correct_option }))
              : undefined,
          });
        }
        toast.success(`Generated ${output.questions.length} question(s) with AI`);
      } else if (aiPipeline === "smriti") {
        if (!selectedDocId) {
          toast.error("Please select a past paper document");
          setIsGeneratingAi(false);
          return;
        }
        const groups = await generateQuestionsFromDocuments({
          documentIds: [selectedDocId],
          topics: [{ topic: aiTopic.trim(), count, fromPapers: false }],
          questionType: aiType,
          marks,
        });

        const MCQ_LETTERS = ["A", "B", "C", "D"];
        let addedCount = 0;
        for (const group of groups) {
          for (const q of group.questions) {
            await createQuestionService({
              assignmentId,
              type: q.type,
              description: q.question_text,
              marks: q.marks || marks,
              options: q.type === "mcq" && q.options
                ? q.options.map((opt, i) => ({ value: opt, isCorrect: MCQ_LETTERS[i] === q.correct_option }))
                : undefined,
            });
            addedCount++;
          }
        }
        toast.success(`Imported ${addedCount} question(s) from past paper`);
      }

      setAiDialogOpen(false);
      await loadAll(false);
    } catch (err: any) {
      toast.error(err.response?.data?.message || err.message || "Failed to generate questions");
    } finally {
      setIsGeneratingAi(false);
    }
  };

  const handleDeleteQuestion = async (questionId: string) => {
    if (!confirm("Delete this question? Any existing student answers to it will also be removed.")) return;
    try {
      await deleteQuestionService(questionId);
      toast.success("Question deleted");
      await loadAll(false);
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Failed to delete question");
    }
  };

  const toDatetimeLocal = (iso: string | null) => {
    if (!iso) return "";
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const openEditAssignment = () => {
    if (!assignment) return;
    setEditTitle(assignment.title);
    setEditStartDate(toDatetimeLocal(assignment.startDate));
    setEditDueDate(toDatetimeLocal(assignment.dueDate));
    setEditTotalMarks(String(assignment.totalMarks));
    setEditDialogOpen(true);
  };

  const handleSaveAssignmentEdit = async () => {
    if (editTitle.trim().length < 3) {
      toast.error("Title must be at least 3 characters");
      return;
    }
    setSavingAssignment(true);
    try {
      const payload: any = { title: editTitle.trim() };
      if (!assignment?.seriesId || assignment.dayGap === null) {
        payload.startDate = editStartDate ? new Date(editStartDate).toISOString() : null;
        payload.dueDate = editDueDate ? new Date(editDueDate).toISOString() : null;
      }
      await updateAssignmentService(assignmentId, payload);
      toast.success("Assignment updated");
      setEditDialogOpen(false);
      loadAll();
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Failed to update assignment");
    } finally {
      setSavingAssignment(false);
    }
  };

  const handleExtend = async () => {
    const days = parseInt(extendDays);
    if (!days || days < 1) {
      toast.error("Enter at least 1 day");
      return;
    }
    setExtending(true);
    try {
      await extendAssignmentService(assignmentId, { days, mode: extendMode, cascade: extendCascade });
      toast.success("Schedule updated");
      setExtendDialogOpen(false);
      loadAll();
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Failed to extend assignment");
    } finally {
      setExtending(false);
    }
  };

  if (loading) return <div className="text-gray-400 text-center py-10">Loading assignment...</div>;
  if (!assignment) return <div className="text-gray-400 text-center py-10">Assignment not found</div>;

  return (
    <div>
      <button
        onClick={() => {
          const backTarget = seriesId
            ? `/teacher/assignments?seriesId=${seriesId}`
            : `/teacher/assignments`;
          router.push(backTarget);
        }}
        className="flex items-center gap-2 text-gray-400 hover:text-white text-sm mb-6 transition-colors"
      >
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold text-white tracking-tight">{assignment.title}</h2>
          {assignment.instructions && <p className="text-gray-400 mt-1">{assignment.instructions}</p>}
          <p className="text-gray-500 text-sm mt-2">
            Total Marks: {assignment.totalMarks}
            {assignment.joinCode ? ` · Join code ${assignment.joinCode}` : " · Students join with the series code"}
            {(!assignment.seriesId || assignment.dayGap === null) && assignment.startDate && ` · Starts ${formatDateTime(assignment.startDate)}`}
            {(!assignment.seriesId || assignment.dayGap === null) && assignment.dueDate && ` · Due ${formatDateTime(assignment.dueDate)}`}
            {assignment.seriesId && assignment.dayGap !== null && ` · #${assignment.sequenceOrder} of weekly series (${assignment.dayGap}-day window, counted from the day each student joined)`}
            {assignment.seriesId && assignment.dayGap === null && ` · #${assignment.sequenceOrder} of custom series`}
          </p>
        </div>

        <div className="flex gap-2 shrink-0">
          <Button
            variant="outline"
            className="bg-transparent border-white/10 text-white hover:bg-white/5"
            onClick={() => router.push(`/teacher/assignments/${assignmentId}/preview`)}
          >
            <Eye className="mr-2 h-4 w-4" /> Preview
          </Button>
          {assignment.seriesId && (
            <Button variant="outline" className="bg-transparent border-white/10 text-white hover:bg-white/5" onClick={() => setExtendDialogOpen(true)}>
              Extend
            </Button>
          )}
          <Button className="bg-orange-600 hover:bg-orange-700 text-white" onClick={openEditAssignment}>
            <Pencil className="mr-2 h-4 w-4" /> Update Assignment
          </Button>
        </div>
      </div>

      <div className="flex justify-end gap-2 mb-4">
        <Button className="bg-purple-600 hover:bg-purple-700 text-white" onClick={() => router.push(`/teacher/assignments/new`)}>
          <Sparkles className="mr-2 h-4 w-4" /> Generate with AI
        </Button>
        <Button className="bg-orange-600 hover:bg-orange-700 text-white" onClick={openCreateQuestion}>
          <Plus className="mr-2 h-4 w-4" /> Add Question
        </Button>
      </div>

      {questions.length === 0 ? (
        <Card className="bg-[#0f0f11] border-white/5 py-10 text-center">
          <CardContent>
            <ListChecks className="h-8 w-8 text-gray-500 mx-auto mb-3" />
            <p className="text-gray-400">No questions yet.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {questions.map((q, idx) => (
            <Card key={q.id} className="bg-[#0f0f11] border-white/5">
              <CardContent>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-bold text-gray-500">Q{idx + 1}</span>
                      <span className="px-2 py-0.5 rounded bg-white/5 text-[10px] font-bold text-gray-400 uppercase">{q.type}</span>
                      <span className="text-xs text-emerald-400 font-semibold">{q.marks} marks</span>
                    </div>
                    <p className="text-white text-sm">{q.description}</p>
                    {q.type === "mcq" && (
                      <div className="mt-2 flex flex-col gap-1">
                        {q.options.map((o, i) => (
                          <div key={o.id || i} className={`text-xs px-2 py-1 rounded ${o.isCorrect ? "bg-emerald-500/15 text-emerald-200 border border-emerald-500/30" : "bg-zinc-800 text-white/70 border border-zinc-700"}`}>
                            {o.isCorrect && <Check className="inline h-3 w-3 mr-1" />}
                            {o.value}
                          </div>
                        ))}
                      </div>
                    )}
                    {q.type === "descriptive" && q.modelAnswer && (
                      <p className="text-xs text-gray-500 mt-2 italic">Model answer: {q.modelAnswer}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button size="sm" variant="outline" className="bg-[#14151f] border-white/15 text-white hover:bg-white/10 h-8 px-3 text-xs font-semibold" onClick={() => openEditQuestion(q)}>
                      Edit
                    </Button>
                    <Button size="sm" variant="outline" className="bg-transparent border-red-500/20 text-red-400 hover:bg-red-500/10 h-8 px-3 text-xs font-semibold" onClick={() => handleDeleteQuestion(q.id)}>
                      Delete
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* ── Create/Edit Question Dialog ──────────────────────────────── */}
      <Dialog open={questionDialogOpen} onOpenChange={setQuestionDialogOpen}>
        <DialogContent className="bg-[#0f0f11] border border-white/10 text-white sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-white text-xl font-bold">{editingQuestion ? "Edit Question" : "Add Question"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2 max-h-[60vh] overflow-y-auto">
            {!editingQuestion && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-300">Question Type</label>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setQType("descriptive")}
                    className={qType === "descriptive" ? "bg-orange-500/20 text-sky-200 border-orange-500/50 font-medium" : "bg-transparent border-white/10 text-white/70"}
                  >
                    Descriptive
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setQType("mcq")}
                    className={qType === "mcq" ? "bg-orange-500/20 text-sky-200 border-orange-500/50 font-medium" : "bg-transparent border-white/10 text-white/70"}
                  >
                    MCQ
                  </Button>
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-300">Description</label>
              <textarea
                value={qDescription}
                onChange={(e) => setQDescription(e.target.value)}
                rows={3}
                placeholder="Write the question..."
                className="w-full bg-[#18181b] border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-gray-600 focus:outline-none focus:ring-1 focus:ring-white/30 transition-all text-sm resize-none"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-300">Marks</label>
              <input
                type="number"
                step="0.5"
                value={qMarks}
                onChange={(e) => setQMarks(e.target.value)}
                className="w-full py-3 text-white transition-all text-sm rounded-none border-0 border-b border-white/20 bg-transparent px-0 transition-colors placeholder:text-zinc-500 focus:border-orange-500 focus:outline-none focus:ring-0"
              />
            </div>

            {qType === "descriptive" ? (
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-300">Model Answer (optional, helps you grade later)</label>
                <textarea
                  value={qModelAnswer}
                  onChange={(e) => setQModelAnswer(e.target.value)}
                  rows={2}
                  className="w-full bg-[#18181b] border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-gray-600 focus:outline-none focus:ring-1 focus:ring-white/30 transition-all text-sm resize-none"
                />
              </div>
            ) : (
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-300">Options (mark the correct one)</label>
                {qOptions.map((opt, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleOptionChange(idx, "isCorrect", !opt.isCorrect)}
                      className={`h-9 w-9 shrink-0 rounded-lg border flex items-center justify-center transition-all ${opt.isCorrect ? "bg-emerald-600 border-emerald-500 text-white" : "bg-[#18181b] border-white/10 text-white/60"}`}
                    >
                      <Check className="h-4 w-4" />
                    </button>
                    <input
                      type="text"
                      value={opt.value}
                      onChange={(e) => handleOptionChange(idx, "value", e.target.value)}
                      placeholder={`Option ${idx + 1}`}
                      className="flex-1 py-2 text-white placeholder:text-gray-600 transition-all text-sm rounded-none border-0 border-b border-white/20 bg-transparent px-0 transition-colors placeholder:text-zinc-500 focus:border-orange-500 focus:outline-none focus:ring-0"
                    />
                    {qOptions.length > 2 && (
                      <Button size="icon" variant="ghost" className="h-9 w-9 text-red-400 hover:text-red-300 shrink-0" onClick={() => setQOptions((prev) => prev.filter((_, i) => i !== idx))}>
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))}
                {qOptions.length < 5 && (
                  <Button type="button" variant="outline" className="w-full bg-transparent border-dashed border-white/10 text-gray-400 hover:text-white" onClick={() => setQOptions((prev) => [...prev, emptyOption()])}>
                    <Plus className="h-4 w-4 mr-2" /> Add Option
                  </Button>
                )}
              </div>
            )}
          </div>

          <DialogFooter className="bg-transparent border-0 p-0 mt-2">
            <Button variant="ghost" size="lg" className="text-gray-300 hover:text-white" onClick={() => setQuestionDialogOpen(false)}>
              Cancel
            </Button>
            <Button size="lg" className="bg-orange-600 hover:bg-orange-700 text-white" onClick={handleSaveQuestion} disabled={savingQuestion}>
              {savingQuestion ? "Saving..." : editingQuestion ? "Save Changes" : "Add Question"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Edit Assignment Dialog ───────────────────────────────────── */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="bg-[#0f0f11] border border-white/10 text-white sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-white text-xl font-bold">Edit Assignment</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-300">Title</label>
              <input
                type="text"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                className="w-full py-3 text-white transition-all text-sm rounded-none border-0 border-b border-white/20 bg-transparent px-0 transition-colors placeholder:text-zinc-500 focus:border-orange-500 focus:outline-none focus:ring-0"
              />
            </div>

            {assignment.seriesId && assignment.dayGap !== null ? (
              <p className="text-xs text-gray-500 p-3 bg-[#18181b] border border-white/10 rounded-lg">
                This assignment is part of a weekly series — its schedule is computed per student. Use "Extend" on the assignment page to change its timing.
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-gray-300">Start Date</label>
                  <DateTimeInput
                    value={editStartDate}
                    onChange={(v) => setEditStartDate(v)}
                   
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-gray-300">Due Date</label>
                  <DateTimeInput
                    value={editDueDate}
                    onChange={(v) => setEditDueDate(v)}
                   
                  />
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="bg-transparent border-0 p-0 mt-2">
            <Button variant="ghost" size="lg" className="text-gray-300 hover:text-white" onClick={() => setEditDialogOpen(false)}>
              Cancel
            </Button>
            <Button size="lg" className="bg-orange-600 hover:bg-orange-700 text-white" onClick={handleSaveAssignmentEdit} disabled={savingAssignment}>
              {savingAssignment ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Extend Assignment Dialog ─────────────────────────────────── */}
      <Dialog open={extendDialogOpen} onOpenChange={setExtendDialogOpen}>
        <DialogContent className="bg-[#0f0f11] border border-white/10 text-white sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-white text-xl font-bold">Extend Assignment</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-300">Extend by (days)</label>
              <Input
                type="number"
                min="1"
                value={extendDays}
                onChange={(e) => setExtendDays(e.target.value)}
                className="text-white text-sm h-auto py-3"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-300">What should move?</label>
              <RadioGroup
                value={extendMode}
                onValueChange={(value) => setExtendMode(value as "grow" | "shift")}
                className="grid grid-cols-1 gap-2"
              >
                {(
                  [
                    { value: "grow", title: "Grow duration", desc: "Start date stays put, due date pushes out — the assignment just runs longer." },
                    { value: "shift", title: "Shift window", desc: "Both start and due date slide later — same duration, just starts later." },
                  ] as const
                ).map((opt) => (
                  <label
                    key={opt.value}
                    className={`flex items-start gap-3 text-left p-3 rounded-lg border cursor-pointer transition-all ${extendMode === opt.value ? "bg-orange-500/20 border-orange-500/50" : "bg-[#18181b] border-white/10 hover:bg-white/5"}`}
                  >
                    <RadioGroupItem value={opt.value} className="mt-0.5 border-gray-500 data-[checked]:border-blue-400" />
                    <div>
                      <p className="text-sm font-medium text-white">{opt.title}</p>
                      <p className="text-xs text-gray-500">{opt.desc}</p>
                    </div>
                  </label>
                ))}
              </RadioGroup>
            </div>

            <div className="flex items-center justify-between p-3 bg-[#18181b] border border-white/10 rounded-lg">
              <div>
                <label className="text-sm font-medium text-gray-300">Reflow later assignments in the series?</label>
                <p className="text-[11px] text-gray-500">On: they shift to chain from this one's new dates. Off: they keep their original schedule.</p>
              </div>
              <Switch checked={extendCascade} onCheckedChange={setExtendCascade} />
            </div>
          </div>

          <DialogFooter className="bg-transparent border-0 p-0 mt-2">
            <Button variant="ghost" size="lg" className="text-gray-300 hover:text-white" onClick={() => setExtendDialogOpen(false)}>
              Cancel
            </Button>
            <Button size="lg" className="bg-orange-600 hover:bg-orange-700 text-white" onClick={handleExtend} disabled={extending}>
              {extending ? "Applying..." : "Apply"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
