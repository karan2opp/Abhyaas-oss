import { getClientForModel } from "../../../common/agent/openai.client.js";
import { env } from "../../../env.js";
import { zodResponseFormat } from "openai/helpers/zod";
import type { z } from "zod";
import {
  ExamIntentAgentOutputZodSchema,
  ConversationSummaryZodSchema,
  type ConversationTurn,
  type ConversationSummary,
  type ExamIntentAgentOutput,
} from "../Types/outputConversation.js";
import type { IInputExam } from "../Types/inputExam.js";
import { searchMemories, addMemories } from "../../../common/utils/mem0.js";
import { getExamIntentSystemPrompt, getExamIntentConcludeInstruction } from "../../../prompts/exam_intent_agent.prompt.js";
import { createMessageFieldExtractor, type StreamHooks } from "../../../common/agent/stream.js";

const topicName = (t: IInputExam["sections"][number]["topics"][number]): string =>
  typeof t === "string" ? t : t.topic;

// Fixed string the "Skip Question" chat button sends as the user's turn, so the
// model sees exactly the marker its system prompt describes.
export const SKIP_QUESTION_SIGNAL = "[[SKIP_QUESTION]] The user has no preference for the question you just asked — do not ask it again.";

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

// Builds a short query describing this exam so mem0 can surface only the
// memories relevant to it (not everything this teacher has ever said).
function buildMemoryQuery(examInput: IInputExam): string {
  const subjects = [...new Set(examInput.sections.map((s) => s.subject))].join(", ");
  const topics = [...new Set(examInput.sections.flatMap((s) => s.topics.map(topicName)))].join(", ");
  const parts = [`Exam preferences for subject(s): ${subjects}`, `topics: ${topics}`];
  if (examInput.educationLevel) parts.push(`education level: ${examInput.educationLevel.value}`);
  if (examInput.difficulty) parts.push(`difficulty: ${examInput.difficulty}`);
  return parts.join(", ");
}

// Flattens the final summary into synthetic "user" turns so mem0's own
// extraction can pull long-term facts out of it, same as it would from a
// real chat transcript.
function summaryToMemoryMessages(summary: ConversationSummary): { role: "user"; content: string }[] {
  const lines = [
    ...summary.globalInstructions.map((i) => `Exam preference (general): ${i}`),
    ...summary.topicSpecificInstructions.flatMap((t) =>
      t.instructions.map((i) => `Exam preference for topic "${t.topic}": ${i}`)
    ),
  ];
  return lines.map((content) => ({ role: "user" as const, content }));
}

// Teaches mem0 what was learned once a summary is final — shared by the text
// turn flow below and the realtime voice flow (Realtime.ts), which produces
// the same ConversationSummary via a tool call instead of response_format.
export function persistIntentMemories(summary: ConversationSummary, examTitle: string | undefined, userId: string): void {
  void addMemories(summaryToMemoryMessages(summary), userId, {
    source: "exam-intent-agent",
    examTitle,
  });
}

async function buildMessages(examInput: IInputExam, history: ConversationTurn[], userId?: string | null): Promise<ChatMessage[]> {
  // Pull in only the memories relevant to this exam (not this teacher's
  // entire history) — no-op (empty array) if mem0 isn't configured.
  const memories = userId ? await searchMemories(buildMemoryQuery(examInput), userId, 5) : [];

  return [
    { role: "system", content: getExamIntentSystemPrompt() },
    { role: "user", content: `Exam skeleton:\n${JSON.stringify(examInput)}` },
    ...(memories.length > 0
      ? [{
        role: "user" as const,
        content: `FALLBACK ONLY — do not mention, reference, or let these shape any question. Use one of these only if the user explicitly gives no preference for that exact aspect (e.g. "I don't know" / "no preference" / "you decide"), to fill that one gap in the summary:\n${memories.map((m) => `- ${m}`).join("\n")}`,
      }]
      : []),
    ...history.map((turn) => ({ role: turn.role, content: turn.content })),
  ];
}

// Retried like every other structured-output call in this codebase
// (evaluateSingleAnswer, generateTopicQuestions): the model occasionally
// returns a malformed/empty object, and without a retry that was an
// unhandled ZodError reaching the teacher as a raw, unreadable message.
// With `stream`, the "message" text of the reply is passed on as it is written. `holdWhenDone` keeps back a reply that
// says it is finished, for a caller that may replace that message.
async function callStructured<T extends z.ZodTypeAny>(
  messages: ChatMessage[],
  schema: T,
  name: string,
  stream?: StreamHooks & { holdWhenDone?: boolean }
): Promise<z.infer<T>> {
  const client = await getClientForModel(env.INTENT_MODEL);
  const MAX_ATTEMPTS = 3;
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      let content: string;
      if (stream?.onText) {
        const extractor = createMessageFieldExtractor({
          onText: stream.onText,
          ...(stream.onReset ? { onReset: stream.onReset } : {}),
          holdWhenDone: stream.holdWhenDone ?? false,
        });
        const response: any = await client.chat.completions.create({
          model: env.INTENT_MODEL,
          messages,
          response_format: zodResponseFormat(schema, name),
          stream: true,
        });
        content = "";
        for await (const chunk of response) {
          const piece = chunk.choices?.[0]?.delta?.content;
          if (piece) {
            content += piece;
            extractor.push(piece);
          }
        }
        extractor.end();
      } else {
        const response = await client.chat.completions.create({
          model: env.INTENT_MODEL,
          messages,
          response_format: zodResponseFormat(schema, name),
        });
        content = response.choices[0]?.message.content || "{}";
      }
      return schema.parse(JSON.parse(content || "{}"));
    } catch (err) {
      lastError = err;
      // Whatever was already shown belongs to the failed attempt, so it is dropped before the next one starts.
      stream?.onReset?.();
      console.warn(
        `[exam-intent-agent] attempt ${attempt + 1}/${MAX_ATTEMPTS} produced an invalid response, ${attempt + 1 < MAX_ATTEMPTS ? "retrying" : "giving up"}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  throw new Error(
    `The exam intent agent could not produce a valid response after ${MAX_ATTEMPTS} attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`
  );
}

/**
 * "Skip All": writes the final summary from the conversation so far in one call. The reply format only
 * allows a summary, so unlike a normal turn the model cannot ask another question.
 */
export async function concludeExamIntent(
  examInput: IInputExam,
  history: ConversationTurn[],
  userId?: string | null
): Promise<ConversationSummary> {
  const messages = await buildMessages(examInput, history, userId);
  messages.push({ role: "system", content: getExamIntentConcludeInstruction() });

  const summary = await callStructured(messages, ConversationSummaryZodSchema, "exam_intent_summary");
  if (userId) persistIntentMemories(summary, examInput.title, userId);
  return summary;
}

export async function examIntentAgentTurn(
  examInput: IInputExam,
  history: ConversationTurn[],
  userId?: string | null,
  hooks?: StreamHooks
) {
  const messages = await buildMessages(examInput, history, userId);
  // On the first turn a reply that says "done" is swapped for a question (below), so it is never streamed.
  let result: ExamIntentAgentOutput = await callStructured(
    messages,
    ExamIntentAgentOutputZodSchema,
    "exam_intent_agent_output",
    hooks ? { ...hooks, holdWhenDone: history.length === 0 } : undefined
  );

  // Hard guarantee, independent of prompt adherence: never let the very
  // first turn conclude with zero questions asked. Memory can make the model
  // over-confident that everything is already known — difficulty, topic
  // emphasis, and question style vary per exam and must be confirmed, not
  // silently inherited from a past exam.
  if (history.length === 0 && result.done) {
    result = {
      done: false,
      message: "What's the goal of this exam? For example, checking fundamentals, testing problem-solving, or practical skills.",
      summary: null,
    };
  }

  // Fire-and-forget: once the conversation concludes, teach mem0 what was
  // learned so future exams from this teacher need fewer questions.
  if (result.done && result.summary && userId) {
    persistIntentMemories(result.summary, examInput.title, userId);
  }

  return result;
}
