import { z } from "zod";

export const createSectionSchema = z.object({
  title: z.string({ message: "Title is required" })
    .min(2, { message: "Title must be at least 2 characters long" })
    .max(100, { message: "Title cannot exceed 100 characters" }),
  examId: z.string({ message: "Exam ID is required" })
    .min(1, { message: "Exam ID cannot be empty" }),

});

export type CreateSectionDto = z.infer<typeof createSectionSchema>;

export const updateSectionSchema = z.object({
  title: z.string({ message: "Title must be a string" })
    .min(2, { message: "Title must be at least 2 characters long" })
    .max(100, { message: "Title cannot exceed 100 characters" })
    .optional(),
});

export type UpdateSectionDto = z.infer<typeof updateSectionSchema>;
