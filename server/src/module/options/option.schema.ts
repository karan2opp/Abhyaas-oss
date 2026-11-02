import { pgTable, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { createId } from "@paralleldrive/cuid2";
import { questions } from "../questions/question.schema.js";

export const options = pgTable("options", {
  id: text("id").primaryKey().$defaultFn(() => createId()),
  questionId: text("question_id").references(() => questions.id, { onDelete: "cascade" }).notNull(),
  value: text("value").notNull(),
  isCorrect: boolean("is_correct").notNull(),
  // When true, `value` is rendered as a code block instead of plain text —
  // for MCQs like "which snippet correctly reverses an array?".
  isCode: boolean("is_code").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type Option = typeof options.$inferSelect;
export type NewOption = typeof options.$inferInsert;
