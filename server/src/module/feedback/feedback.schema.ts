import { pgTable, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createId } from "@paralleldrive/cuid2";
import { exams } from "../exam/exam.schema.js";
import { users } from "../auth/user.schema.js";
import { submissions } from "../submissions/submission.schema.js";

export const feedbacks = pgTable("feedbacks", {
  id: text("id").primaryKey().$defaultFn(() => createId()),
  examId: text("exam_id").references(() => exams.id, { onDelete: "cascade" }).notNull(),
  studentId: text("student_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  submissionId: text("submission_id").references(() => submissions.id, { onDelete: "cascade" }).notNull(),
  experienceRating: integer("experience_rating").notNull(),
  experienceText: text("experience_text"),
  aiEvaluationRating: integer("ai_evaluation_rating"),
  aiEvaluationText: text("ai_evaluation_text"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type Feedback = typeof feedbacks.$inferSelect;
export type NewFeedback = typeof feedbacks.$inferInsert;
