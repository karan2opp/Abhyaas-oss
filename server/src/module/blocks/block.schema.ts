import { pgTable, text, integer, doublePrecision, timestamp } from "drizzle-orm/pg-core";
import { createId } from "@paralleldrive/cuid2";
import { sections } from "../sections/section.schema.js";
import { questionTypeEnum } from "../questions/question-type.enum.js";

// A content container under an exam Section (or directly under an Assignment).
// Each block carries its own subject, instructions, question type, marks and
// question count — enabling multi-subject exams/assignments. Exactly one of
// section_id / assignment_id is set. assignment_id has no FK (plain text) to
// avoid a circular import with assignment.schema; assignment deletion cleans up
// its blocks explicitly in the assignment service.
export const blocks = pgTable("blocks", {
  id: text("id").primaryKey().$defaultFn(() => createId()),
  sectionId: text("section_id").references(() => sections.id, { onDelete: "cascade" }),
  assignmentId: text("assignment_id"),
  name: text("name").notNull(),
  subject: text("subject").notNull(),
  questionType: questionTypeEnum("question_type").default("mcq").notNull(),
  questionCount: integer("question_count").default(0).notNull(),
  totalMarks: doublePrecision("total_marks").default(0).notNull(),
  instructions: text("instructions").array(),
  position: integer("position").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type Block = typeof blocks.$inferSelect;
export type NewBlock = typeof blocks.$inferInsert;
