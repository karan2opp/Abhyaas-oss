import { z } from "zod";

export const createFeedbackSchema = z.object({
  examId: z.string({ message: "Exam ID is required" }),
  submissionId: z.string({ message: "Submission ID is required" }),
  experienceRating: z.number({ message: "Experience rating is required" })
    .min(1, "Rating must be between 1 and 5")
    .max(5, "Rating must be between 1 and 5"),
  experienceText: z.string().optional(),
  aiEvaluationRating: z.number()
    .min(1, "Rating must be between 1 and 5")
    .max(5, "Rating must be between 1 and 5")
    .optional(),
  aiEvaluationText: z.string().optional(),
});

export type CreateFeedbackDto = z.infer<typeof createFeedbackSchema>;
