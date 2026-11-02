
import { z } from "zod"

export const joinExamSchema = z.object({
  joinCode: z.string({ message: "Join code is required" })
    .length(6, "Join code must be 6 characters")
    .toUpperCase()
})

export type JoinExamDto = z.infer<typeof joinExamSchema>

export const updateSubmissionSchema = z.object({
  status: z.enum(["inprogress", "submitted", "timeout"], {
    message: "Status must be 'inprogress', 'submitted', or 'timeout'"
  }).optional(),
  score: z.number({ message: "Score must be a number" }).optional(),
});

export type UpdateSubmissionDto = z.infer<typeof updateSubmissionSchema>;

export const gradeExamSubmissionSchema = z.object({
  answers: z.array(z.object({
    answerId: z.string({ message: "Answer ID is required" }).min(1),
    marksAwarded: z.number({ message: "marksAwarded is required" }).min(0),
    feedback: z.string().optional(),
  })).min(1, "At least one graded answer is required"),
  overallFeedback: z.string().optional(),
});

export type GradeExamSubmissionDto = z.infer<typeof gradeExamSubmissionSchema>;

export const evaluateWithAiSchema = z.object({
  mode: z.enum(["marks_only", "marks_and_feedback"]).default("marks_and_feedback"),
});

export type EvaluateWithAiDto = z.infer<typeof evaluateWithAiSchema>;
