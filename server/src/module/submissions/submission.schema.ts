import { pgTable, text, timestamp, pgEnum, doublePrecision, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { users } from "../auth/user.schema.js";
import { exams } from "../exam/exam.schema.js";

export const submissionStatusEnum = pgEnum("submission_status", ["inprogress", "submitted", "timeout", "evaluating"]);

export const submissions = pgTable("submissions", {
  id: text("id").primaryKey().$defaultFn(() => createId()),
  userId: text("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  examId: text("exam_id").references(() => exams.id, { onDelete: "cascade" }).notNull(),
  status: submissionStatusEnum("status").notNull(),
  score: doublePrecision("score"),
  submittedAt: timestamp("submitted_at"),
  // Set only when a teacher has manually reviewed/graded this submission
  // (as opposed to it only ever having gone through auto MCQ + AI scoring).
  gradedBy: text("graded_by").references(() => users.id),
  gradedAt: timestamp("graded_at"),
  overallFeedback: text("overall_feedback"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at")   // null = active, timestamp = deleted
}, (table) => [
  // One active submission per exam per student. Partial index so a soft-deleted
  // submission (deletedAt != null) does not block a future re-attempt.
  uniqueIndex("submissions_active_exam_user_idx")
    .on(table.examId, table.userId)
    .where(sql`${table.deletedAt} is null`),
]);

// A student who entered the join code of an exam that hasn't started yet. It lets the exam show up on their dashboard
// (with its countdown and a Join button) so they don't have to type the code again. One row per student per exam.
export const examRegistrations = pgTable("exam_registrations", {
  id: text("id").primaryKey().$defaultFn(() => createId()),
  userId: text("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  examId: text("exam_id").references(() => exams.id, { onDelete: "cascade" }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("exam_registrations_exam_user_idx").on(table.examId, table.userId),
]);

export type Submission = typeof submissions.$inferSelect;
export type NewSubmission = typeof submissions.$inferInsert;
