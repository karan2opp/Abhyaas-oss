import { z } from "zod";

export const createExamSchema = z.object({
  title: z.string({ message: "Title is required" })
    .min(3, { message: "Title must be at least 3 characters long" })
    .max(100, { message: "Title cannot exceed 100 characters" }),
  type: z.enum(["SCHEDULED", "ON_DEMAND"]).default("SCHEDULED"),
  instructions: z.array(z.string()).optional(),
  duration: z.number({ message: "Duration is required" })
    .min(1, { message: "Duration must be at least 1 minute" })
    .max(180, { message: "Duration cannot exceed 180 minutes" }).optional(),
  startTime: z.coerce.date({ message: "Start time is required" }).optional(),
  endTime: z.coerce.date({ message: "End time is required" }).optional(),
  totalMarks: z.number({ message: "Total marks must be a number" })
    .min(0, { message: "Total marks must be at least 0" }).optional().default(0),
  requireFeedback: z.boolean().optional().default(false),
  publishTime: z.coerce.date().nullable().optional(),
  status: z.enum(["DRAFT", "PUBLISHED", "UNSAVED"]).optional().default("DRAFT"),
}).refine(data => {
  if (data.type === "SCHEDULED") {
    if (!data.startTime || !data.endTime) return false;
    return data.endTime > data.startTime;
  }
  return true;
}, {
  message: "For scheduled exams, start and end times are required and end time must be after start time",
  path: ["endTime"],
});

export type CreateExamDto = z.infer<typeof createExamSchema>;

export const updateExamSchema = z.object({
  title: z.string({ message: "Title must be a string" })
    .min(3, { message: "Title must be at least 3 characters long" })
    .max(100, { message: "Title cannot exceed 100 characters" })
    .optional(),
  type: z.enum(["SCHEDULED", "ON_DEMAND"]).optional(),
  instructions: z.array(z.string()).optional(),
  duration: z.number({ message: "Duration must be a number" })
    .min(1, { message: "Duration must be at least 1 minute" })
    .max(180, { message: "Duration cannot exceed 180 minutes" })
    .optional(),
  startTime: z.coerce.date({ message: "Invalid start time date format" }).optional(),
  endTime: z.coerce.date({ message: "Invalid end time date format" }).optional(),
  totalMarks: z.number({ message: "Total marks must be a number" })
    .min(0, { message: "Total marks must be at least 0" })
    .optional(),
  requireFeedback: z.boolean().optional(),
  publishTime: z.coerce.date().nullable().optional(),
  status: z.enum(["DRAFT", "PUBLISHED"]).optional(),
}).refine(data => {
  if (data.type === "SCHEDULED" || (!data.type && data.startTime && data.endTime)) {
    if (data.startTime && data.endTime) {
      return data.endTime > data.startTime;
    }
  }
  return true;
}, {
  message: "End time must be after start time",
  path: ["endTime"],
});

export type UpdateExamDto = z.infer<typeof updateExamSchema>;

export const joinExamSchema = z.object({
  joinCode: z.string({ message: "Join code is required" })
    .length(6, { message: "Join code must be exactly 6 characters" })
    .regex(/^[A-Z0-9]+$/, { message: "Join code must be uppercase letters and numbers only" }),
});

export type JoinExamDto = z.infer<typeof joinExamSchema>;
