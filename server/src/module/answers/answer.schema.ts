import { pgTable, text, timestamp, boolean, doublePrecision, uniqueIndex } from "drizzle-orm/pg-core";
import { createId } from "@paralleldrive/cuid2";
import { submissions } from "../submissions/submission.schema.js";
import { questions } from "../questions/question.schema.js";

export const answers = pgTable("answers", {
  id: text("id").primaryKey().$defaultFn(() => createId()),
  submissionId: text("submission_id").references(() => submissions.id, { onDelete: "cascade" }).notNull(),
  questionId: text("question_id").references(() => questions.id, { onDelete: "cascade" }).notNull(),
  options: text("options").array(), // array of option ids
  textAnswer: text("text_answer"),
  isCorrect: boolean("is_correct"),
  marksAwarded: doublePrecision("marks_awarded"),
  feedback: text("feedback"),
  // Who last set marksAwarded/feedback. A teacher can always override an AI
  // grade, but AI (re-)evaluation must never overwrite a teacher's grade.
  evaluatedBy: text("evaluated_by").$type<"ai" | "teacher">(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  // One answer per question per submission.
  uniqueIndex("answers_submission_question_idx").on(table.submissionId, table.questionId),
]);

export type Answer = typeof answers.$inferSelect;
export type NewAnswer = typeof answers.$inferInsert;
