import { z } from "zod";

export const TopicSpecificInstructionZodSchema = z.object({
    topic: z.string().describe("The topic this instruction applies to"),
    instructions: z.array(z.string()).describe("Instructions scoped to this topic only"),
});

export const ConversationSummaryZodSchema = z.object({
    // What the exam is for, in the teacher's words. Shapes which subtopics are picked and what each question asks.
    // Empty when the teacher gave none. Summaries saved before this field existed don't have it at all.
    goal: z.string().describe("The exam's goal in one sentence, in the teacher's terms. Empty string if none was given."),
    globalInstructions: z.array(z.string()).describe("Instructions that apply to the whole exam"),
    topicSpecificInstructions: z.array(TopicSpecificInstructionZodSchema).describe("Instructions grouped by the topic they apply to"),
});

export const ExamIntentAgentOutputZodSchema = z.object({
    // true once enough information has been gathered — the caller should stop
    // sending turns and move on to the subtopics agent.
    done: z.boolean().describe("Whether enough information has been gathered to proceed"),
    // The next clarifying question to show the user, or a short closing
    // message when done is true.
    message: z.string().describe("The next question to ask, or a closing message if done"),
    // null until done is true — the final recap of everything gathered, split
    // into whole-exam guidance and per-topic guidance. OpenAI's structured
    // outputs mode requires every field to be present, so this is nullable
    // rather than optional (same pattern as allocatedQuestions elsewhere).
    summary: ConversationSummaryZodSchema.nullable().describe("Structured recap of gathered instructions, null until done is true"),
});

export type TopicSpecificInstruction = z.infer<typeof TopicSpecificInstructionZodSchema>;
export type ConversationSummary = z.infer<typeof ConversationSummaryZodSchema>;
export type ExamIntentAgentOutput = z.infer<typeof ExamIntentAgentOutputZodSchema>;

export const ConversationTurnZodSchema = z.object({
    role: z.enum(["assistant", "user"]),
    content: z.string(),
});

export type ConversationTurn = z.infer<typeof ConversationTurnZodSchema>;
