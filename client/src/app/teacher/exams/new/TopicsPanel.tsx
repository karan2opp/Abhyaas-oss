"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, Loader2, Plus, Search, Sparkles, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { listPaperTopics, listQuestionBankDocuments } from "@/services/questionBank.service";
import { addTopicService, removeTopicService } from "@/app/teacher/exams/exam.service";

const DIFFICULTY_ITEMS = [
  { value: "easy", label: "Easy" },
  { value: "medium", label: "Medium" },
  { value: "hard", label: "Hard" },
];

type TopicRow = { topic: string; count: number; edited: number; subtopics: string[] };

// A question counts as edited when it was changed after it was created (generation saves a whole batch within a moment).
const wasEdited = (q: any) => new Date(q.updatedAt).getTime() - new Date(q.createdAt).getTime() > 5000;

/**
 * A searchable list of the topics found in the teacher's uploaded papers. Several can be ticked; anything typed that is
 * not in the list can be added as it is, so the teacher is never limited to the papers.
 */
function TopicSearchDialog({
  open,
  onOpenChange,
  topics,
  loading,
  selected,
  onToggle,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  topics: { topic: string; available: number }[];
  loading: boolean;
  selected: string[];
  onToggle: (topic: string) => void;
}) {
  const [query, setQuery] = useState("");
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const typed = query.trim();
  const search = typed.toLowerCase();
  const shown = search ? topics.filter((t) => t.topic.toLowerCase().includes(search)) : topics;
  const canUseTyped = typed.length > 0 && !topics.some((t) => t.topic.trim().toLowerCase() === search);
  const isOn = (topic: string) => selected.some((s) => s.trim().toLowerCase() === topic.trim().toLowerCase());

  const rowClass = "flex w-full items-center gap-3 px-1 py-3 text-left transition-colors hover:bg-white/5";
  const box = (on: boolean) => (
    <span className={cn("flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border", on ? "border-orange-500 bg-orange-500 text-black" : "border-white/25")}>
      {on && <Check className="h-3 w-3" />}
    </span>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-4">
        <DialogHeader>
          <DialogTitle>Choose topics</DialogTitle>
          <DialogDescription>These are the topics found in your uploaded papers. Tick as many as you like, or type your own.</DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="pointer-events-none absolute left-0 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search topics" autoFocus className="pl-6 text-white placeholder:text-zinc-500" />
        </div>

        <div className="custom-scrollbar -mx-1 min-h-0 flex-1 overflow-y-auto pr-1">
          {loading ? (
            <div className="flex items-center gap-2 px-1 py-3 text-xs text-gray-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading the topics in your papers...
            </div>
          ) : (
            <ul className="divide-y divide-white/5">
              {canUseTyped && (
                <li>
                  <button type="button" onClick={() => onToggle(typed)} className={rowClass}>
                    {box(isOn(typed))}
                    <span className="min-w-0 flex-1 truncate text-sm text-white">Use &quot;{typed}&quot;</span>
                    <span className="shrink-0 text-[11px] text-gray-500">Your own topic</span>
                  </button>
                </li>
              )}
              {shown.map((t) => (
                <li key={t.topic}>
                  <button type="button" onClick={() => onToggle(t.topic)} className={rowClass}>
                    {box(isOn(t.topic))}
                    <span className="min-w-0 flex-1 truncate text-sm text-white">{t.topic}</span>
                    <span className="shrink-0 text-[11px] text-gray-500">{t.available} question{t.available === 1 ? "" : "s"}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {!loading && shown.length === 0 && !canUseTyped && (
            <p className="px-1 py-3 text-xs italic text-gray-500">{search ? "No topics match your search." : "No topics found in your papers yet. Type your own above."}</p>
          )}
        </div>

        <DialogFooter>
          <Button type="button" onClick={() => onOpenChange(false)} className="bg-orange-600 font-semibold text-white hover:bg-orange-700">
            Done{selected.length > 0 ? ` (${selected.length})` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The topics an exam section covers, read from the tag on each question. Teachers can remove a topic (its questions
 * are deleted) or add a new one (AI plans its subtopics and writes the questions). Existing topics are never edited
 * in place. Questions without a tag (written by hand, or from before topics were tracked) simply don't appear here.
 */
export function TopicsPanel({ examId, section, canEdit, refresh }: { examId: string; section: any; canEdit: boolean; refresh: () => void }) {
  const sectionId = section._id || section.id;
  const groups: any[] = section.blocks || [];

  const [isAdding, setIsAdding] = useState(false);
  const [busy, setBusy] = useState<"add" | string | null>(null);
  const [newTopics, setNewTopics] = useState<string[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [description, setDescription] = useState("");
  const [count, setCount] = useState("5");
  const [difficulty, setDifficulty] = useState("medium");
  const [blockId, setBlockId] = useState("");
  const [topicPickerOpen, setTopicPickerOpen] = useState(false);
  const [paperTopics, setPaperTopics] = useState<{ topic: string; available: number }[] | null>(null);
  const [loadingTopics, setLoadingTopics] = useState(false);

  const rows = useMemo<TopicRow[]>(() => {
    const byTopic = new Map<string, TopicRow>();
    for (const q of section.questions || []) {
      if (!q.topic) continue;
      const row: TopicRow = byTopic.get(q.topic) ?? { topic: q.topic, count: 0, edited: 0, subtopics: [] };
      row.count++;
      if (wasEdited(q)) row.edited++;
      if (q.subtopic && !row.subtopics.includes(q.subtopic)) row.subtopics.push(q.subtopic);
      byTopic.set(q.topic, row);
    }
    return [...byTopic.values()];
  }, [section.questions]);

  // The topics in the teacher's papers are only fetched the first time the picker is opened.
  const openTopicPicker = async () => {
    setTopicPickerOpen(true);
    if (paperTopics !== null || loadingTopics) return;
    setLoadingTopics(true);
    try {
      const documents = await listQuestionBankDocuments();
      const ids = documents.filter((d) => d.status === "completed").map((d) => d.id);
      const found = ids.length > 0 ? await listPaperTopics(ids) : [];
      setPaperTopics(found.map((t) => ({ topic: t.topic, available: t.mcq + t.descriptive })));
    } catch {
      // The picker still works for typing a topic of your own.
      setPaperTopics([]);
    } finally {
      setLoadingTopics(false);
    }
  };

  // Nothing to show and nothing the teacher can do (e.g. a published exam made without topics).
  if (rows.length === 0 && !canEdit) return null;

  const chosenBlockId = blockId || groups[0]?.id || "";
  // The dropdowns need to be told what to show for each value, or they show the raw value (an id) instead.
  const blockItems = groups.map((g) => ({ value: g.id, label: `${g.subject || g.name} · ${g.questionType === "mcq" ? "MCQ" : "Descriptive"}` }));

  const toggleNewTopic = (name: string) =>
    setNewTopics((prev) => (prev.some((t) => t.trim().toLowerCase() === name.trim().toLowerCase()) ? prev.filter((t) => t.trim().toLowerCase() !== name.trim().toLowerCase()) : [...prev, name.trim()]));

  const handleAdd = async () => {
    const n = Number(count);
    if (newTopics.length === 0) return toast.error("Choose at least one topic");
    if (!Number.isInteger(n) || n < 1 || n > 15) return toast.error("Number of questions must be between 1 and 15");
    if (!chosenBlockId) return toast.error("This section has no question group to add to yet. Add a question first.");
    setBusy("add");
    const remaining = [...newTopics];
    let added = 0;
    try {
      // One after another: each topic is written into the exam as the previous one left it. Topics already done are
      // taken off the list, so if one fails the rest are still there to try again.
      for (const name of newTopics) {
        setProgress({ done: newTopics.length - remaining.length, total: newTopics.length });
        const res = await addTopicService(examId, { sectionId, blockId: chosenBlockId, topic: name, description: description.trim() || undefined, count: n, difficulty });
        added += res?.data?.added ?? n;
        remaining.shift();
        setNewTopics([...remaining]);
      }
      toast.success(`Added ${added} question${added === 1 ? "" : "s"} for ${newTopics.length === 1 ? `"${newTopics[0]}"` : `${newTopics.length} topics`}`);
      setDescription("");
      setIsAdding(false);
    } catch (err: any) {
      toast.error(`${remaining[0] ? `"${remaining[0]}": ` : ""}${err.response?.data?.message || err.message || "Failed to add topic"}`);
    } finally {
      setBusy(null);
      setProgress(null);
      if (added > 0) refresh();
    }
  };

  const handleRemove = async (row: TopicRow) => {
    const editedNote = row.edited > 0 ? ` ${row.edited} of them ${row.edited === 1 ? "has" : "have"} been edited by you.` : "";
    if (!confirm(`Remove "${row.topic}"? This deletes its ${row.count} question${row.count === 1 ? "" : "s"}.${editedNote}`)) return;
    setBusy(row.topic);
    try {
      await removeTopicService(examId, { sectionId, topic: row.topic });
      toast.success(`Removed "${row.topic}"`);
      refresh();
    } catch (err: any) {
      toast.error(err.response?.data?.message || err.message || "Failed to remove topic");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h5 className="text-xs font-bold uppercase tracking-wider text-gray-400">Topics</h5>
        {canEdit && !isAdding && (
          <Button size="sm" variant="ghost" onClick={() => setIsAdding(true)} className="h-8 px-2 text-xs font-semibold text-orange-400 hover:bg-orange-500/10 hover:text-orange-300">
            <Plus className="mr-1 h-3.5 w-3.5" /> Add topic
          </Button>
        )}
      </div>

      {rows.length > 0 && !isAdding ? (
        <ul className="divide-y divide-white/5">
          {rows.map((row) => (
            <li key={row.topic} className="flex items-start justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-white">
                  {row.topic} <span className="font-normal text-gray-500">· {row.count} question{row.count === 1 ? "" : "s"}</span>
                </p>
              </div>
              {canEdit && (
                <button
                  onClick={() => handleRemove(row)}
                  disabled={busy !== null}
                  aria-label={`Remove topic ${row.topic}`}
                  className="mt-0.5 shrink-0 rounded-md p-1.5 text-gray-500 transition-colors hover:bg-red-500/10 hover:text-red-400 disabled:opacity-40"
                >
                  {busy === row.topic ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        !isAdding && <p className="text-xs text-gray-500">No topics yet. Add one and the AI will plan its subtopics and write the questions.</p>
      )}

      {isAdding && (
        <div className="space-y-4 pt-1">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-gray-300">Choose topics</label>
            <button
              type="button"
              onClick={openTopicPicker}
              disabled={busy === "add"}
              className="flex h-11 w-full items-center justify-between gap-1.5 border-b border-white/20 py-2 pr-1 text-left text-sm transition-colors hover:border-orange-500 focus-visible:border-orange-500 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="truncate text-zinc-500">{newTopics.length === 0 ? "Select or search topics" : "Add more topics"}</span>
              <ChevronDown className="size-4 shrink-0 text-orange-400" />
            </button>
            {newTopics.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-1">
                {newTopics.map((t) => (
                  <span key={t} className="inline-flex max-w-full items-center gap-1 rounded-full border border-orange-500/40 bg-orange-500/10 py-1 pl-3 pr-1.5 text-xs text-orange-200">
                    <span className="truncate">{t}</span>
                    <button
                      type="button"
                      onClick={() => toggleNewTopic(t)}
                      disabled={busy === "add"}
                      aria-label={`Remove ${t}`}
                      className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-orange-300 hover:bg-orange-500/20 disabled:opacity-40"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <TopicSearchDialog open={topicPickerOpen} onOpenChange={setTopicPickerOpen} topics={paperTopics ?? []} loading={loadingTopics} selected={newTopics} onToggle={toggleNewTopic} />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-gray-300">
              Description <span className="font-normal text-gray-500">(optional)</span>
            </label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What should these questions cover? e.g. nested if-else and else-if ladders, with short code to trace"
              disabled={busy === "add"}
              rows={2}
              className="min-h-0 resize-none rounded-none border-0 border-b border-white/20 bg-transparent px-0 shadow-none text-white placeholder:text-zinc-500 focus:border-orange-500 focus-visible:border-orange-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-gray-300">Questions</label>
              <Input type="number" min={1} max={15} value={count} onChange={(e) => setCount(e.target.value)} disabled={busy === "add"} className="text-white" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-gray-300">Difficulty</label>
              <Select items={DIFFICULTY_ITEMS} value={difficulty} onValueChange={(v) => v && setDifficulty(v)} disabled={busy === "add"}>
                <SelectTrigger className="w-full text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-white/10 bg-[#0f0f11] text-white">
                  <SelectItem value="easy">Easy</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="hard">Hard</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {groups.length > 1 && (
              <div className="col-span-2 space-y-1.5 sm:col-span-1">
                <label className="text-xs font-semibold text-gray-300">Add to</label>
                <Select items={blockItems} value={chosenBlockId} onValueChange={(v) => v && setBlockId(v)} disabled={busy === "add"}>
                  <SelectTrigger className="w-full text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="border-white/10 bg-[#0f0f11] text-white">
                    {blockItems.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
            <Button variant="ghost" onClick={() => setIsAdding(false)} disabled={busy === "add"} className="text-gray-400 hover:text-white">
              Cancel
            </Button>
            <Button onClick={handleAdd} disabled={busy === "add"} className="bg-orange-600 font-semibold text-white hover:bg-orange-700">
              {busy === "add" ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> {progress && progress.total > 1 ? `Writing topic ${progress.done + 1} of ${progress.total}…` : "Writing questions…"}
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 h-4 w-4" /> Generate
                </>
              )}
            </Button>
          </div>
          {busy === "add" && <p className="text-xs text-gray-500">The AI is planning subtopics and writing questions. This can take up to a minute per topic.</p>}
        </div>
      )}
    </div>
  );
}
