import { z } from "zod";

export const createOptionSchema = z.object({
  questionId: z.string({ message: "Question ID is required" })
    .min(1, { message: "Question ID cannot be empty" }),
  value: z.string({ message: "Value is required" })
    .min(1, { message: "Value must be at least 1 character long" }),
  isCorrect: z.boolean({ message: "isCorrect is required" }),
});

export type CreateOptionDto = z.infer<typeof createOptionSchema>;

export const createOptionsSchema = z.array(createOptionSchema, {
  message: "Options are required"
})
  .min(2, { message: "At least 2 options are required" })
  .max(5, { message: "At most 4 options are allowed" });

export type CreateOptionsDto = z.infer<typeof createOptionsSchema>;

export const updateOptionSchema = z.object({
  value: z.string({ message: "Value must be a string" })
    .min(1, { message: "Value must be at least 1 character long" })
    .optional(),
  isCorrect: z.boolean({ message: "isCorrect must be a boolean" })
    .optional(),
});

export type UpdateOptionDto = z.infer<typeof updateOptionSchema>;
