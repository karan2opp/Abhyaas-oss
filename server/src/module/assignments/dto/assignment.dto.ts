import { z } from "zod";

export const createSeriesSchema = z.object({
    title: z.string({ message: "Title is required" })
        .min(3, "Title must be at least 3 characters long")
        .max(100, "Title cannot exceed 100 characters"),
    type: z.enum(["weekly", "custom"]).default("weekly"),
});

export type CreateSeriesDto = z.infer<typeof createSeriesSchema>;

export const updateSeriesSchema = z.object({
    title: z.string({ message: "Title is required" })
        .min(3, "Title must be at least 3 characters long")
        .max(100, "Title cannot exceed 100 characters"),
});

export type UpdateSeriesDto = z.infer<typeof updateSeriesSchema>;

// Whether dayGap vs. startDate/dueDate is required for a series assignment
// depends on the series' `type` (weekly vs custom), which requires a DB
// lookup — that branch is validated in the service layer, not here.
const assignmentOptionSchema = z.object({
    value: z.string({ message: "Option value is required" }).min(1, "Option value cannot be empty"),
    isCorrect: z.boolean({ message: "isCorrect is required" }),
});

const assignmentBlockQuestionSchema = z.object({
    type: z.enum(["mcq", "descriptive"], { message: "Question type must be mcq or descriptive" }),
    description: z.string({ message: "Description is required" }).min(1, "Description cannot be empty"),
    marks: z.number({ message: "Marks are required" }).min(0.5, "Marks must be at least 0.5"),
    modelAnswer: z.string().optional(),
    rubric: z.any().optional(),
    options: z.array(assignmentOptionSchema).optional(),
});

const assignmentBlockSchema = z.object({
    name: z.string({ message: "Block name is required" }).min(1, "Block name cannot be empty"),
    subject: z.string({ message: "Block subject is required" }).min(1, "Block subject cannot be empty"),
    questionType: z.enum(["mcq", "descriptive"]).optional().default("mcq"),
    instructions: z.array(z.string()).optional(),
    totalMarks: z.number().min(0).optional().default(0),
    questions: z.array(assignmentBlockQuestionSchema).optional(),
});

export const createAssignmentSchema = z.object({
    title: z.string({ message: "Title is required" })
        .min(3, "Title must be at least 3 characters long")
        .max(100, "Title cannot exceed 100 characters"),
    instructions: z.string().optional(),
    totalMarks: z.number({ message: "Total marks must be a number" })
        .min(0, "Total marks must be at least 0").optional().default(0),
    startDate: z.coerce.date().optional(),
    dueDate: z.coerce.date().optional(),
    // Series-only field (weekly series):
    seriesId: z.string().min(1).optional(),
    dayGap: z.number().int().min(1).optional(),
    blocks: z.array(assignmentBlockSchema).optional(),
});

export type CreateAssignmentDto = z.infer<typeof createAssignmentSchema>;

export const updateAssignmentSchema = z.object({
    title: z.string().min(3).max(100).optional(),
    instructions: z.string().optional(),
    totalMarks: z.number().min(1).optional(),
    startDate: z.coerce.date().nullable().optional(),
    dueDate: z.coerce.date().nullable().optional(),
    dayGap: z.number().int().min(1).nullable().optional(),
});

export type UpdateAssignmentDto = z.infer<typeof updateAssignmentSchema>;

export const extendAssignmentSchema = z.object({
    days: z.number().int().min(1, "Must extend by at least 1 day"),
    mode: z.enum(["grow", "shift"], { message: "Mode must be 'grow' or 'shift'" }),
    cascade: z.boolean({ message: "cascade is required" }),
});

export type ExtendAssignmentDto = z.infer<typeof extendAssignmentSchema>;

export const createAssignmentQuestionSchema = z.object({
    assignmentId: z.string({ message: "Assignment ID is required" }).min(1),
    type: z.enum(["mcq", "descriptive"], { message: "Question type must be mcq or descriptive" }),
    description: z.string({ message: "Description is required" })
        .min(10, "Description must be at least 10 characters long"),
    images: z.array(z.object({ url: z.string().url(), publicId: z.string() })).optional(),
    marks: z.coerce.number({ message: "Marks are required" }).min(0.5, "Marks must be at least 0.5"),
    modelAnswer: z.string().optional(),
    options: z.array(assignmentOptionSchema).min(2).max(5).optional(),
})
    .refine((data) => {
        if (data.type === "mcq" && (!data.options || data.options.length === 0)) return false;
        return true;
    }, { message: "MCQ questions must have options" })
    .refine((data) => {
        if (data.type === "descriptive" && data.options) return false;
        return true;
    }, { message: "Descriptive questions cannot have options" })
    .refine((data) => {
        if (data.type === "mcq" && data.options) return data.options.some(opt => opt.isCorrect === true);
        return true;
    }, { message: "MCQ must have at least one correct option" });

export type CreateAssignmentQuestionDto = z.infer<typeof createAssignmentQuestionSchema>;

export const updateAssignmentQuestionSchema = z.object({
    description: z.string().min(10).optional(),
    marks: z.coerce.number().min(0.5).optional(),
    modelAnswer: z.string().optional(),
    images: z.array(z.object({ url: z.string().url(), publicId: z.string() })).optional(),
    options: z.array(assignmentOptionSchema.extend({ id: z.string().optional() })).min(2).max(5).optional(),
});

export type UpdateAssignmentQuestionDto = z.infer<typeof updateAssignmentQuestionSchema>;

export const saveAssignmentAnswerSchema = z.object({
    submissionId: z.string({ message: "Submission ID is required" }).min(1),
    questionId: z.string({ message: "Question ID is required" }).min(1),
    options: z.array(z.string()).optional(),
    textAnswer: z.string().max(5000, "Text answer cannot exceed 5000 characters").optional(),
}).refine(data => {
    const hasOptions = data.options !== undefined && data.options.length > 0;
    const hasTextAnswer = data.textAnswer !== undefined && data.textAnswer.trim().length > 0;
    return (hasOptions || hasTextAnswer) && !(hasOptions && hasTextAnswer);
}, { message: "Provide either options or textAnswer, but not both" });

export type SaveAssignmentAnswerDto = z.infer<typeof saveAssignmentAnswerSchema>;

export const gradeAssignmentSubmissionSchema = z.object({
    answers: z.array(z.object({
        answerId: z.string({ message: "Answer ID is required" }).min(1),
        marksAwarded: z.number({ message: "marksAwarded is required" }).min(0),
        feedback: z.string().optional(),
    })).min(1, "At least one graded answer is required"),
    overallFeedback: z.string().optional(),
});

export type GradeAssignmentSubmissionDto = z.infer<typeof gradeAssignmentSubmissionSchema>;

export const joinAssignmentSchema = z.object({
    joinCode: z.string({ message: "Join code is required" })
        .length(6, "Join code must be 6 characters")
        .toUpperCase(),
});

export type JoinAssignmentDto = z.infer<typeof joinAssignmentSchema>;
