import { pgTable, text, timestamp, doublePrecision, integer, jsonb } from "drizzle-orm/pg-core";
import { createId } from "@paralleldrive/cuid2";
import { sections } from "../sections/section.schema.js";
import { blocks } from "../blocks/block.schema.js";
import { questionTypeEnum } from "./question-type.enum.js";

// Supplementary content shown between the question text and its options (for
// an MCQ) — a code listing, a table, or a list. Deliberately NOT html: raw
// markup from a model can't be validated and would be an XSS vector on a page
// students are logged into, so each kind gets its own typed, renderable shape
// instead. Optional and usually absent — only add one when the question is
// unreadable without it (e.g. "what does this code print?").
export interface CodeContentBlock {
  type: "code";
  language: string;
  code: string;
}

// A cell is plain text, or text plus how many columns / rows it covers (like HTML's colspan and rowspan). Each row lists
// only the cells that start in it; a cell merged down from a row above is left out of the rows below it.
export type TableCell = string | { text: string; colspan?: number | null; rowspan?: number | null };

export interface TableContentBlock {
  type: "table";
  headers: TableCell[];
  rows: TableCell[][];
}

// A list is written as plain text, one item per line ("- " for a bullet, "1. " for a number, a sub-item indented under
// its parent), and the page draws the bullets, numbers and indentation. Older lists were saved as separate items with a
// single numbered / bulleted flag, so those fields stay for reading them.
export interface ListContentBlock {
  type: "list";
  text?: string;
  ordered?: boolean;
  items?: string[];
}

// A picture from the question's source paper (a figure, graph or diagram the question refers to).
export interface ImageContentBlock {
  type: "image";
  url: string;
  width: number | null;
  height: number | null;
}

export type QuestionContentBlock = CodeContentBlock | TableContentBlock | ListContentBlock | ImageContentBlock;

export const questions = pgTable("questions", {
  id: text("id").primaryKey().$defaultFn(() => createId()),
  sectionId: text("section_id").references(() => sections.id, { onDelete: "cascade" }).notNull(),
  blockId: text("block_id").references(() => blocks.id, { onDelete: "cascade" }),
  type: questionTypeEnum("type").notNull(),
  description: text("description").notNull(),
  // The question's place in its section's list — "question 4" means the
  // question whose position is 3 (0-indexed) among its section's questions.
  // Set once at creation, in generation/entry order, and never touched again
  // unless the question is removed. createdAt can't serve this purpose: a
  // whole batch of questions inserted in the same transaction (the normal
  // case for AI generation) shares one identical timestamp, so ordering by
  // it is not actually deterministic — this column exists specifically
  // because that ambiguity let "question 4" resolve to a different question
  // on two different reads of the same exam.
  position: integer("position").default(0).notNull(),
  images: jsonb("images").$type<{ url: string; publicId: string }[]>(),
  // Ordered — rendered in this sequence, after the description and before
  // the options. Empty for the overwhelming majority of questions.
  contentBlocks: jsonb("content_blocks").$type<QuestionContentBlock[]>().default([]).notNull(),
  // The topic and subtopic this question was generated for. Null for questions written by hand and for exams made
  // before topics were tracked. Removing a topic from an exam deletes the questions that carry its name.
  topic: text("topic"),
  subtopic: text("subtopic"),
  marks: doublePrecision("marks").notNull(),
  modelAnswer: text("model_answer"),
  rubric: jsonb("rubric").$type<{
    categories: {
      name: string;
      weight: number;
      key_points: string[];
    }[];
  }>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type Question = typeof questions.$inferSelect;
export type NewQuestion = typeof questions.$inferInsert;
