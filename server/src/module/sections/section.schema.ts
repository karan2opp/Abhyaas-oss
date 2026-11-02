import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createId } from "@paralleldrive/cuid2";
import { exams } from "../exam/exam.schema.js";

export const sections = pgTable("sections", {
  id: text("id").primaryKey().$defaultFn(() => createId()),
  title: text("title").notNull(),
  examId: text("exam_id").references(() => exams.id, { onDelete: "cascade" }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type Section = typeof sections.$inferSelect;
export type NewSection = typeof sections.$inferInsert;
