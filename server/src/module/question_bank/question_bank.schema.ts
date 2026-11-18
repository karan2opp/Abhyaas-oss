import { pgTable, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createId } from "@paralleldrive/cuid2";
import { users } from "../auth/user.schema.js";

export interface QuestionBankImage {
    url: string;
    width: number | null;
    height: number | null;
    page: number;
}

export interface QuestionBankTable {
    page: number;
    header: string[] | null;
    rows: (string | null)[][];
}

export interface QuestionBankList {
    items: string[];
}

// One parsed MCQ choice. `label` is the marker as printed ("A", "ii", "3")
// and is stripped out of questionText; `text` is the choice itself, which is
// content, not noise — an MCQ is unanswerable without it. Every `text` here
// is verified to appear verbatim in the chunk's rawText before it is stored
// (see question_bank_classifier.ts), so options can never be invented.
export interface QuestionBankOption {
    label: string;
    text: string;
}

// A paper's topics as a two-level tree: broad topics (roughly chapters, e.g. "Arrays") that each hold subtopics
// (e.g. "Searching"). Each subtopic belongs to exactly one broad topic. A question is tagged with up to two
// subtopics, so a question can sit under two broad topics through two different subtopics.
// `aliases` are the tag spellings (compared ignoring capitals and spaces) that the classifier gave questions and that
// were merged into this subtopic, so "Binary search" and "binary search algorithm" count as one.
export interface QuestionBankSubtopic {
    name: string;
    aliases: string[];
}

export interface QuestionBankBroadTopic {
    name: string;
    subtopics: QuestionBankSubtopic[];
}

export interface QuestionBankTopicTree {
    broadTopics: QuestionBankBroadTopic[];
}

// One row per uploaded PYQ PDF. status tracks the async Inngest pipeline
// (extract -> chunk -> classify -> embed -> upsert) independently of the
// HTTP request that kicked it off.
export const questionBankDocuments = pgTable("question_bank_documents", {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    createdBy: text("created_by").references(() => users.id).notNull(),
    title: text("title").notNull(),
    fileUrl: text("file_url").notNull(),
    status: text("status").$type<"pending" | "processing" | "completed" | "failed">().default("pending").notNull(),
    totalChunks: integer("total_chunks").default(0).notNull(),
    // How far processing has got, 0-100, and what it is doing right now ("Reading questions 16 of 50"), so the paper
    // list can show a progress bar. Only ever goes up while a paper is processed.
    progress: integer("progress").default(0).notNull(),
    progressLabel: text("progress_label"),
    error: text("error"),
    // Built once at the end of processing (see question_bank_topic_tree.ts). null for papers processed before topic
    // trees existed, and for a paper whose grouping step has not run; those fall back to a flat list of subtopics.
    topicTree: jsonb("topic_tree").$type<QuestionBankTopicTree>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// One row per extracted question. `id` is a UUID (not the usual cuid2 —
// Qdrant point IDs must be an unsigned integer or a UUID) and is reused
// verbatim as the Qdrant point ID, so a search hit's point ID IS this row's
// primary key — no separate mapping table needed. rawText/images/tables/lists
// are the verbatim extracted content (never model-generated); subject/topics/
// description are the one LLM-classified layer on top, and description is
// what actually gets embedded (see question_bank_classifier.ts).
export const questionBankChunks = pgTable("question_bank_chunks", {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    documentId: text("document_id").references(() => questionBankDocuments.id, { onDelete: "cascade" }).notNull(),
    questionNumber: text("question_number"),
    // Verbatim extracted text, markers and all — the audit trail. Never
    // rewritten, never stripped; questionText below is the cleaned view.
    rawText: text("raw_text").notNull(),
    // The question stem alone: rawText minus the option lines and the answer
    // line, which are lifted out into `options`/`correctOption` instead.
    // Falls back to rawText when nothing could be parsed out.
    questionText: text("question_text"),
    options: jsonb("options").$type<QuestionBankOption[]>().default([]),
    // The answer key when the source paper prints one ("Answer: C") — stored
    // as the option label. Ground truth that can't be recovered any other way.
    correctOption: text("correct_option"),
    // Where correctOption came from: "paper" (the paper's answer key, or printed with the question) or "ai" (no answer
    // was given, so the model worked it out). Not shown anywhere yet; kept so the two can be told apart later.
    answerSource: text("answer_source").$type<"paper" | "ai">(),
    subject: text("subject"),
    topics: text("topics").array(),
    description: text("description"),
    pageStart: integer("page_start").notNull(),
    pageEnd: integer("page_end").notNull(),
    images: jsonb("images").$type<QuestionBankImage[]>().default([]),
    tables: jsonb("tables").$type<QuestionBankTable[]>().default([]),
    lists: jsonb("lists").$type<QuestionBankList[]>().default([]),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type QuestionBankDocument = typeof questionBankDocuments.$inferSelect;
export type NewQuestionBankDocument = typeof questionBankDocuments.$inferInsert;
export type QuestionBankChunk = typeof questionBankChunks.$inferSelect;
export type NewQuestionBankChunk = typeof questionBankChunks.$inferInsert;
