import { z } from "zod";

// Each edit changes only what it names — the section total is allowed to move.
// The teacher is asked to auto-balance or keep the new total when they proceed.

export const SetSubtopicCountArgsZodSchema = z.object({
    section: z.string().describe("The exact name of the exam section this subtopic belongs to"),
    topic: z.string().describe("The topic this subtopic belongs to"),
    subtopic: z.string().describe("The subtopic to change"),
    count: z.number().int().min(0).describe("The subtopic's new question count. 0 removes the subtopic."),
});

export const SetTopicCountArgsZodSchema = z.object({
    section: z.string().describe("The exact name of the exam section this topic belongs to"),
    topic: z.string().describe("The topic to change"),
    count: z.number().int().min(0).describe("The topic's new question count, split across its subtopics in their current proportions. 0 removes the topic."),
});

export const AddSubtopicArgsZodSchema = z.object({
    section: z.string().describe("The exact name of the exam section to add this subtopic in"),
    topic: z.string().describe("The topic to add this subtopic under"),
    name: z.string().describe("The new subtopic's name"),
    count: z.number().int().min(1).describe("How many questions the new subtopic gets. If the teacher hasn't said, ask them before calling this tool."),
});

export const DeleteSubtopicArgsZodSchema = z.object({
    section: z.string().describe("The exact name of the exam section this subtopic belongs to"),
    topic: z.string(),
    subtopic: z.string(),
});

// OpenAI's structured-outputs/tool mode requires every field to be present, so
// "not given" is expressed as nullable rather than optional.
export const AddTopicArgsZodSchema = z.object({
    section: z.string().describe("The exact name of the exam section to add this topic to"),
    name: z.string().describe("The new topic's name"),
    subtopics: z.array(z.string()).nullable().describe(
        "Only set this (non-null) if the teacher explicitly named the subtopics they want. Otherwise pass null — " +
        "the system will generate well-reasoned subtopics for this topic automatically (same quality " +
        "process used for the rest of the exam), rather than you inventing them yourself."
    ),
    count: z.number().int().min(1).describe("How many questions the new topic gets in total. If the teacher hasn't said, ask them before calling this tool."),
});

export const DeleteTopicArgsZodSchema = z.object({
    section: z.string().describe("The exact name of the exam section this topic belongs to"),
    topic: z.string(),
});

export const IncreaseTotalQuestionCountArgsZodSchema = z.object({
    section: z.string().describe("The exact name of the exam section whose total question count should change"),
    new_total: z.number().int().min(1).describe("The section's new total question count (must be explicitly requested by the teacher, not inferred). Every topic and subtopic is rescaled proportionally."),
});

export type SetSubtopicCountArgs = z.infer<typeof SetSubtopicCountArgsZodSchema>;
export type SetTopicCountArgs = z.infer<typeof SetTopicCountArgsZodSchema>;
export type AddSubtopicArgs = z.infer<typeof AddSubtopicArgsZodSchema>;
export type DeleteSubtopicArgs = z.infer<typeof DeleteSubtopicArgsZodSchema>;
export type AddTopicArgs = z.infer<typeof AddTopicArgsZodSchema>;
export type DeleteTopicArgs = z.infer<typeof DeleteTopicArgsZodSchema>;
export type IncreaseTotalQuestionCountArgs = z.infer<typeof IncreaseTotalQuestionCountArgsZodSchema>;
