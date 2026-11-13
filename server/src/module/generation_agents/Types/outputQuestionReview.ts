import { z } from "zod";
import { TableCellZodSchema } from "../table_blocks.util.js";

// Same three shapes as the generation agent's output (outputGeneration.ts) —
// kept as a separate definition (this agent has its own independent tool
// schemas) but must stay structurally compatible with question.schema.ts's
// QuestionContentBlock, since both end up in the same DB column.
export const ContentBlockInputZodSchema = z.union([
    z.object({ type: z.literal("code"), language: z.string(), code: z.string() }),
    z.object({ type: z.literal("table"), headers: z.array(TableCellZodSchema), rows: z.array(z.array(TableCellZodSchema)) }),
    z.object({ type: z.literal("list"), text: z.string() }),
    // Lists saved before lists were written as text; they have to be copied back unchanged.
    z.object({ type: z.literal("list"), ordered: z.boolean(), items: z.array(z.string()) }),
]);

export const OptionInputZodSchema = z.object({
    text: z.string(),
    isCode: z.boolean().describe("true only if this option IS a code snippet — false for an ordinary text option."),
});

// Operates on the REAL saved exam (questions/options tables), addressed by
// real section/block/question ids — not the generation pipeline's session
// JSON. section_id/block_id come from the current exam structure given to
// the agent as context; question_id comes from the current question list.

// Manual: the teacher dictates the exact question — no LLM call, just record
// it. For an MCQ, options + correct_option are required; for a descriptive
// question they are null (its grading guide is written later, not here).
export const AddQuestionArgsZodSchema = z.object({
    section_id: z.string().describe("The id of the exam section this question belongs to"),
    block_id: z.string().nullable().describe("The id of the block this question belongs to, if the section has blocks — null otherwise"),
    type: z.enum(["mcq", "descriptive"]),
    question_text: z.string().describe("The exact question text, as dictated by the teacher"),
    marks: z.number().min(0.5).describe("Marks for this question"),
    options: z.array(OptionInputZodSchema).nullable().describe("Exactly 4 options — required (non-null) when type is mcq, null when descriptive"),
    correct_option: z.enum(["A", "B", "C", "D"]).nullable().describe("Required (non-null) when type is mcq, null when descriptive"),
    content_blocks: z
        .array(ContentBlockInputZodSchema)
        .describe("Code/table/list content the teacher dictated alongside the question. Empty array when there is none — most questions have none."),
    // Makes a REPLACE atomic: the old question is only removed once the new
    // one is created (and, for MCQ, has passed its correctness check) — so a
    // "replace" can never leave the exam with both, or with neither. Never
    // call remove_question separately for this same question when you set
    // this; it is handled as part of this same call.
    replaces_question_id: z
        .string()
        .nullable()
        .describe("The id of an existing question this new one REPLACES, if the teacher asked to replace/swap a question rather than just add one alongside it. null for an ordinary addition."),
});

// AI-generated: hard-capped at 3 per call so one request never turns into a
// bulk regeneration — the teacher can always ask again for more.
export const GenerateQuestionsArgsZodSchema = z.object({
    section_id: z.string().describe("The id of the exam section to generate into"),
    block_id: z.string().nullable().describe("The id of the block to generate into, if the section has blocks — null otherwise"),
    subject: z.string().describe("The subject to write the question(s) in (e.g. JavaScript)"),
    question_type: z.enum(["mcq", "descriptive"]),
    topic: z.string().describe("The topic these questions are about"),
    subtopic: z.string().describe("The specific subtopic to generate new question(s) for"),
    marks: z.number().min(0.5).describe("Marks for each generated question"),
    count: z.number().int().min(1).max(3).describe("How many new questions to generate — 1 to 3 at a time, never more"),
    instructions: z.array(z.string()).nullable().describe("Extra guidance for these specific questions (e.g. \"make them harder\"), or null"),
    // Same atomic-replace mechanism as add_question. Only meaningful when
    // count is 1 — replacing one question with several doesn't have a
    // single well-defined target, so leave this null and remove the old one
    // separately in that case.
    replaces_question_id: z
        .string()
        .nullable()
        .describe("The id of an existing question this replaces, when the teacher asked to replace it with a NEW AI-written one (count must be 1). null for an ordinary addition."),
});

export const RemoveQuestionArgsZodSchema = z.object({
    question_id: z.string().describe("The id of the question to remove, from the current question list"),
});

// Always the COMPLETE edited question — text, content blocks, and options
// (MCQ) together — so the parts can never drift out of sync, and an MCQ's
// whole new version is fact-checked before it's saved.
export const UpdateQuestionArgsZodSchema = z.object({
    question_id: z.string().describe("The id of the question to update"),
    question_text: z.string().describe("The question's full new text"),
    content_blocks: z
        .array(ContentBlockInputZodSchema)
        .describe("The question's complete code/table/list content after the edit. Copy unchanged blocks back exactly, character for character. Empty array if it has none."),
    options: z
        .array(OptionInputZodSchema)
        .nullable()
        .describe("MCQ: all 4 options after the edit, unchanged ones copied back exactly. null for a descriptive question."),
    correct_option: z.enum(["A", "B", "C", "D"]).nullable().describe("MCQ: the correct option after the edit. null for a descriptive question."),
});

export const UpdateQuestionOptionsArgsZodSchema = z.object({
    question_id: z.string().describe("The id of the MCQ question to change — must already be type mcq"),
    options: z.array(OptionInputZodSchema).min(4).max(4).describe("The new set of exactly 4 options"),
    correct_option: z.enum(["A", "B", "C", "D"]).describe("The correct option key among the new options"),
});

export type AddQuestionArgs = z.infer<typeof AddQuestionArgsZodSchema>;
export type GenerateQuestionsArgs = z.infer<typeof GenerateQuestionsArgsZodSchema>;
export type RemoveQuestionArgs = z.infer<typeof RemoveQuestionArgsZodSchema>;
export type UpdateQuestionArgs = z.infer<typeof UpdateQuestionArgsZodSchema>;
export type UpdateQuestionOptionsArgs = z.infer<typeof UpdateQuestionOptionsArgsZodSchema>;
