import { z } from "zod";

export const createAnswerSchema = z.object({
  submissionId: z.string({ message: "Submission ID is required" })
    .min(1, { message: "Submission ID cannot be empty" }),
  questionId: z.string({ message: "Question ID is required" })
    .min(1, { message: "Question ID cannot be empty" }),
  options: z.array(z.string({ message: "Option ID must be a string" }), {
    message: "Options must be an array of strings"
  }).optional(),
  textAnswer: z.string({ message: "Text answer must be a string" })
    .max(5000, { message: "Text answer cannot exceed 5000 characters" })
    .optional(),
  marksAwarded: z.number({ message: "Marks awarded must be a number" }).optional(),
}).refine(data => {
  const hasOptions = data.options !== undefined && data.options.length > 0;
  const hasTextAnswer = data.textAnswer !== undefined && data.textAnswer.trim().length > 0;
  
  return (hasOptions || hasTextAnswer) && !(hasOptions && hasTextAnswer);
}, {
  message: "Provide either options or textAnswer, but not both",
});

export type CreateAnswerDto = z.infer<typeof createAnswerSchema>;

export const updateAnswerSchema = z.object({
  marksAwarded: z.number({ message: "Marks awarded must be a number" }).optional(),
  isCorrect: z.boolean({ message: "isCorrect must be a boolean" }).optional(),
});

export type UpdateAnswerDto = z.infer<typeof updateAnswerSchema>;
