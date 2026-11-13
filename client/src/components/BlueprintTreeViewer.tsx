"use client";

import React, { useState } from "react";
import { Plus, Trash2, ChevronDown, ChevronRight, AlertTriangle, BookMarked, Sparkles, Pencil, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface BlueprintSubtopic {
  name: string;
  allocatedQuestions: number;
  sourceNodeIds?: string[];
}

export interface BlueprintTopic {
  topic: string;
  subtopics: BlueprintSubtopic[];
}

export interface BlueprintBlock {
  name: string;
  subject: string;
  question_type: string;
  total_marks: number;
  instructions?: string[];
  topics: BlueprintTopic[];
  unmatchedTopics?: string[];
}

export interface BlueprintSection {
  name: string;
  blocks: BlueprintBlock[];
}

export interface BlueprintTree {
  title: string;
  exam_type?: string;
  instructions?: string[];
  sections: BlueprintSection[];
}

export interface SubtopicSourceInfo {
  chapter: string;
  section: string;
  name: string;
  pages: [number, number];
}

interface BlueprintTreeViewerProps {
  blueprint: BlueprintTree;
  onChange: (updatedBlueprint: BlueprintTree) => void;
  // When the exam is built from a book: subsection id → where it is, to show each subtopic's source.
  sourceLookup?: Record<string, SubtopicSourceInfo>;
  // Opens the refinement chat. The button is only shown when this is given.
  onRefine?: () => void;
  // Rename / delete a whole section. The owner keeps its own section list in step, so the buttons only show when given.
  onRenameSection?: (sectionIndex: number, name: string) => void;
  onDeleteSection?: (sectionIndex: number) => void;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const countOf = (topics: BlueprintTopic[]) =>
  topics.reduce((tAcc, top) => tAcc + top.subtopics.reduce((stAcc, st) => stAcc + (st.allocatedQuestions || 0), 0), 0);

// Names and subtopics are editable but read like plain text: no underline until you hover or click into one.
const plainField = "rounded-md border-b-0 px-2 hover:bg-white/5 focus:border-b-0 focus:bg-white/5";

const outlineButton =
  "inline-flex h-8 items-center gap-1 rounded-md border border-orange-500/30 bg-orange-500/10 px-2.5 text-xs font-bold text-orange-400 transition-colors hover:bg-orange-500/20 hover:text-orange-300";

export function BlueprintTreeViewer({ blueprint, onChange, sourceLookup, onRefine, onRenameSection, onDeleteSection }: BlueprintTreeViewerProps) {
  const [collapsedSections, setCollapsedSections] = useState<Record<number, boolean>>({});
  const [editingSection, setEditingSection] = useState<number | null>(null);
  const [draftName, setDraftName] = useState("");

  const saveSectionName = (sIdx: number) => {
    const name = draftName.trim();
    if (!name) return;
    onRenameSection?.(sIdx, name);
    setEditingSection(null);
  };

  const handleDeleteSection = (sIdx: number, questions: number) => {
    const detail = questions > 0 ? ` Its ${plural(questions, "question")} will not be generated.` : "";
    if (!confirm(`Delete this section from the plan?${detail}`)) return;
    setEditingSection(null);
    onDeleteSection?.(sIdx);
  };

  const toggleSectionCollapse = (sIdx: number) => {
    setCollapsedSections((prev) => ({ ...prev, [sIdx]: !prev[sIdx] }));
  };

  const updateBlueprint = (updater: (draft: BlueprintTree) => void) => {
    const next = JSON.parse(JSON.stringify(blueprint)) as BlueprintTree;
    updater(next);
    onChange(next);
  };

  const handleUpdateBlockSubject = (sIdx: number, bIdx: number, newSubject: string) => {
    updateBlueprint((draft) => {
      draft.sections[sIdx].blocks[bIdx].subject = newSubject;
    });
  };

  const handleUpdateTopic = (sIdx: number, bIdx: number, tIdx: number, newTitle: string) => {
    updateBlueprint((draft) => {
      draft.sections[sIdx].blocks[bIdx].topics[tIdx].topic = newTitle;
    });
  };

  const handleAddTopic = (sIdx: number, bIdx: number) => {
    updateBlueprint((draft) => {
      draft.sections[sIdx].blocks[bIdx].topics.push({
        topic: "New Topic",
        subtopics: [{ name: "New Subtopic", allocatedQuestions: 1 }],
      });
    });
  };

  const handleDeleteTopic = (sIdx: number, bIdx: number, tIdx: number) => {
    updateBlueprint((draft) => {
      draft.sections[sIdx].blocks[bIdx].topics.splice(tIdx, 1);
    });
  };

  const handleUpdateSubtopicName = (sIdx: number, bIdx: number, tIdx: number, stIdx: number, newName: string) => {
    updateBlueprint((draft) => {
      draft.sections[sIdx].blocks[bIdx].topics[tIdx].subtopics[stIdx].name = newName;
    });
  };

  const handleUpdateSubtopicCount = (sIdx: number, bIdx: number, tIdx: number, stIdx: number, delta: number) => {
    updateBlueprint((draft) => {
      const subtopic = draft.sections[sIdx].blocks[bIdx].topics[tIdx].subtopics[stIdx];
      subtopic.allocatedQuestions = Math.max(0, (subtopic.allocatedQuestions || 0) + delta);
    });
  };

  const handleAddSubtopic = (sIdx: number, bIdx: number, tIdx: number) => {
    updateBlueprint((draft) => {
      draft.sections[sIdx].blocks[bIdx].topics[tIdx].subtopics.push({ name: "New Subtopic", allocatedQuestions: 1 });
    });
  };

  const handleDeleteSubtopic = (sIdx: number, bIdx: number, tIdx: number, stIdx: number) => {
    updateBlueprint((draft) => {
      draft.sections[sIdx].blocks[bIdx].topics[tIdx].subtopics.splice(stIdx, 1);
    });
  };

  const totalQuestions = blueprint.sections.reduce(
    (sAcc, sec) => sAcc + sec.blocks.reduce((bAcc, block) => bAcc + countOf(block.topics), 0),
    0
  );

  return (
    <div className="mx-auto w-full max-w-3xl space-y-10">
      {/* Refine with AI: at the top right, styled like the "Review with AI" button on the question list step. */}
      {onRefine && (
        <div className="-mb-4 flex justify-end">
          <Button onClick={onRefine} className="h-10 gap-2 rounded-full bg-orange-600 px-5 text-sm font-semibold text-white hover:bg-orange-700">
            <Sparkles className="h-4 w-4" /> Refine with AI
          </Button>
        </div>
      )}

      {/* Header */}
      <div className="min-w-0">
        <span className="block text-[11px] font-bold uppercase tracking-wider text-orange-400">Exam blueprint</span>
        <h3 className="mt-1 break-words text-xl font-extrabold text-white sm:text-2xl">{blueprint.title}</h3>
        {blueprint.sections.length > 1 && (
          <p className="mt-1 text-xs text-zinc-400">
            {plural(totalQuestions, "question")} · {plural(blueprint.sections.length, "section")}
          </p>
        )}
      </div>

      {/* Sections */}
      {blueprint.sections.map((section, sIdx) => {
        const isCollapsed = collapsedSections[sIdx];
        const sectionQuestionsCount = section.blocks.reduce((bAcc, block) => bAcc + countOf(block.topics), 0);
        const defaultName = `Section ${String.fromCharCode(65 + sIdx)}`;

        return (
          // On phones the section runs the full width of the screen (it bleeds past the page's side gutter); from sm up it is a normal rounded card.
          <section key={sIdx} className="-mx-4 overflow-hidden rounded-none border-y border-white/10 bg-white/[0.02] sm:mx-0 sm:rounded-xl sm:border">
            {/* Section header: open/close, name, count, and edit / delete */}
            <div className="flex items-center gap-2 border-b border-white/5 bg-white/[0.04] px-4 py-3 sm:gap-3 sm:px-5">
              {editingSection === sIdx ? (
                <>
                  <span className="shrink-0 rounded border border-orange-500/30 bg-orange-500/10 px-2 py-0.5 text-xs font-extrabold text-orange-400">
                    {defaultName}
                  </span>
                  <Input
                    autoFocus
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveSectionName(sIdx);
                      if (e.key === "Escape") setEditingSection(null);
                    }}
                    placeholder="Section name..."
                    className="h-8 min-w-0 flex-1 text-sm font-bold text-white"
                  />
                  <button type="button" onClick={() => saveSectionName(sIdx)} aria-label="Save name" className="rounded-md p-1.5 text-green-400 transition-colors hover:bg-green-500/10">
                    <Check className="h-4 w-4" />
                  </button>
                  <button type="button" onClick={() => setEditingSection(null)} aria-label="Cancel" className="rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-white/10 hover:text-white">
                    <X className="h-4 w-4" />
                  </button>
                </>
              ) : (
                <>
                  <button type="button" onClick={() => toggleSectionCollapse(sIdx)} className="flex min-w-0 flex-1 items-center gap-2 text-left sm:gap-3">
                    {isCollapsed ? (
                      <ChevronRight className="h-4 w-4 shrink-0 text-zinc-400" />
                    ) : (
                      <ChevronDown className="h-4 w-4 shrink-0 text-zinc-400" />
                    )}
                    <span className="shrink-0 rounded border border-orange-500/30 bg-orange-500/10 px-2 py-0.5 text-xs font-extrabold text-orange-400">
                      {defaultName}
                    </span>
                    {/* A section with the default name would just repeat the label, so only show a custom name. */}
                    {section.name.trim().toLowerCase() !== defaultName.toLowerCase() && (
                      <h4 className="min-w-0 truncate text-sm font-bold text-white">{section.name}</h4>
                    )}
                  </button>
                  <span className="shrink-0 text-xs font-semibold text-zinc-300">{plural(sectionQuestionsCount, "question")}</span>
                  {onRenameSection && (
                    <button
                      type="button"
                      onClick={() => {
                        setDraftName(section.name);
                        setEditingSection(sIdx);
                      }}
                      aria-label="Rename section"
                      className="rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-white/10 hover:text-white"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {onDeleteSection && (
                    <button
                      type="button"
                      onClick={() => handleDeleteSection(sIdx, sectionQuestionsCount)}
                      disabled={blueprint.sections.length <= 1}
                      aria-label="Delete section"
                      title={blueprint.sections.length <= 1 ? "An exam needs at least one section" : "Delete section"}
                      className="rounded-md p-1.5 text-red-400 transition-colors hover:bg-red-500/10 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </>
              )}
            </div>

            {!isCollapsed && (
              <div className="space-y-4 p-3 sm:p-5">
                {section.blocks.length === 0 ? (
                  <p className="py-4 text-center text-xs italic text-zinc-500">No blocks in this section yet.</p>
                ) : (
                  section.blocks.map((blockObj, bIdx) => (
                    <div key={bIdx} className="space-y-4">
                      {/* One subject and question type per section: its details and a way to add topics */}
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                        <div className="flex min-w-[10rem] flex-1 items-center gap-2">
                          <span className="shrink-0 text-[10px] font-semibold uppercase text-zinc-500">Subject</span>
                          <Input
                            value={blockObj.subject}
                            onChange={(e) => handleUpdateBlockSubject(sIdx, bIdx, e.target.value)}
                            placeholder="Subject..."
                            className={cn(plainField, "h-8 min-w-0 flex-1 text-sm font-semibold text-white")}
                          />
                        </div>
                        <span className="rounded border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-semibold uppercase text-zinc-400">
                          {blockObj.question_type || "mcq"}
                        </span>
                        <button type="button" onClick={() => handleAddTopic(sIdx, bIdx)} className={outlineButton}>
                          <Plus className="h-3.5 w-3.5" /> Add Topic
                        </button>
                      </div>

                      <div className="space-y-3">
                        {sourceLookup && blockObj.unmatchedTopics && blockObj.unmatchedTopics.length > 0 && (
                          <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-200">
                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                            <span>
                              Not found in this book, so no questions were planned for:{" "}
                              <span className="font-semibold">{blockObj.unmatchedTopics.join(", ")}</span>
                            </span>
                          </div>
                        )}
                        {blockObj.topics.length === 0 ? (
                          <p className="py-4 text-center text-xs italic text-zinc-500">No topics in this block yet.</p>
                        ) : (
                          blockObj.topics.map((topicObj, tIdx) => (
                            <div key={tIdx} className="space-y-3 py-1">
                              {/* Topic row */}
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-2 border-b border-white/5 pb-3">
                                <div className="flex min-w-[10rem] flex-1 items-center gap-2">
                                  <Input
                                    value={topicObj.topic}
                                    onChange={(e) => handleUpdateTopic(sIdx, bIdx, tIdx, e.target.value)}
                                    placeholder="Enter topic title..."
                                    className={cn(plainField, "h-9 min-w-0 flex-1 text-sm font-bold text-white")}
                                  />
                                </div>
                                {/* The count, Subtopic button and delete icon stay together: if there is no room beside the
                                    title they move down as one row instead of the icon dropping alone. */}
                                <div className="flex shrink-0 items-center gap-2">
                                  <span className="shrink-0 rounded border border-orange-500/30 bg-orange-500/10 px-2.5 py-1 text-xs font-bold text-orange-400">
                                    {plural(countOf([topicObj]), "question")}
                                  </span>
                                  <button type="button" onClick={() => handleAddSubtopic(sIdx, bIdx, tIdx)} className={outlineButton}>
                                    <Plus className="h-3.5 w-3.5" /> Subtopic
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteTopic(sIdx, bIdx, tIdx)}
                                    aria-label="Delete topic"
                                    className="rounded-md p-1.5 text-red-400 transition-colors hover:bg-red-500/10 hover:text-red-300"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              </div>

                              {/* Subtopic rows */}
                              <div className="space-y-2 sm:pl-4">
                                {topicObj.subtopics.map((stObj, stIdx) => (
                                  <div key={stIdx} className="rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2 transition-colors hover:border-white/15">
                                    <div className="flex items-center gap-2 sm:gap-3">
                                      <span className="text-xs font-bold text-orange-400">•</span>
                                      <Input
                                        value={stObj.name}
                                        onChange={(e) => handleUpdateSubtopicName(sIdx, bIdx, tIdx, stIdx, e.target.value)}
                                        placeholder="Subtopic name..."
                                        className={cn(plainField, "h-7 min-w-0 flex-1 text-xs font-medium text-zinc-100 focus:text-white")}
                                      />
                                      <div className="flex h-7 shrink-0 items-center overflow-hidden rounded-md border border-white/10 bg-white/5">
                                        <button
                                          type="button"
                                          onClick={() => handleUpdateSubtopicCount(sIdx, bIdx, tIdx, stIdx, -1)}
                                          aria-label="Fewer questions"
                                          className="h-full px-2 text-xs font-bold text-zinc-400 transition-colors hover:bg-white/10 hover:text-white"
                                        >
                                          −
                                        </button>
                                        <span className="min-w-[2rem] border-x border-white/10 px-2 text-center text-xs font-bold text-orange-400">
                                          {stObj.allocatedQuestions || 0}
                                        </span>
                                        <button
                                          type="button"
                                          onClick={() => handleUpdateSubtopicCount(sIdx, bIdx, tIdx, stIdx, 1)}
                                          aria-label="More questions"
                                          className="h-full px-2 text-xs font-bold text-zinc-400 transition-colors hover:bg-white/10 hover:text-white"
                                        >
                                          +
                                        </button>
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() => handleDeleteSubtopic(sIdx, bIdx, tIdx, stIdx)}
                                        aria-label="Delete subtopic"
                                        className="p-1 text-zinc-500 transition-colors hover:text-red-400"
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </button>
                                    </div>
                                    {sourceLookup && <SubtopicSource sourceNodeIds={stObj.sourceNodeIds} sourceLookup={sourceLookup} />}
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

function SubtopicSource({ sourceNodeIds, sourceLookup }: { sourceNodeIds?: string[]; sourceLookup: Record<string, SubtopicSourceInfo> }) {
  const sources = (sourceNodeIds ?? []).map((id) => sourceLookup[id]).filter((s): s is SubtopicSourceInfo => !!s);
  if (sources.length === 0) {
    return (
      <p className="mt-1.5 pl-5 text-[11px] text-zinc-500 italic">
        No book section linked yet. One is matched when questions are generated.
      </p>
    );
  }
  return (
    <div className="mt-1.5 pl-5 space-y-0.5">
      {sources.map((source, i) => (
        <p key={i} className="flex items-center gap-1.5 text-[11px] text-zinc-400">
          <BookMarked className="h-3 w-3 text-emerald-400 shrink-0" />
          <span className="truncate">
            {source.chapter} › {source.section === source.name ? source.name : `${source.section} › ${source.name}`}
          </span>
          <span className="shrink-0 text-zinc-500">
            · {source.pages[0] === source.pages[1] ? `p. ${source.pages[0]}` : `pp. ${source.pages[0]}–${source.pages[1]}`}
          </span>
        </p>
      ))}
    </div>
  );
}
