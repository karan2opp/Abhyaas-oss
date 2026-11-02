import api from "@/utils/axios";
import { streamPost, type ChatStreamHandlers } from "@/utils/streamPost";

export type QuestionType = "mcq" | "descriptive";
export type Difficulty = "easy" | "medium" | "hard";

export type EducationCategory =
  | "Lower Middle School"
  | "Middle School"
  | "High School"
  | "Senior Secondary"
  | "Undergraduate"
  | "Postgraduate"
  | "Professional"
  | "Not Specified";

export interface EducationLevel {
  value: string;
  category: EducationCategory;
}

export type TopicInput =
  | string
  | { topic: string; subtopics?: string[]; instructions?: string[] };

export interface SectionInput {
  name: string;
  subject: string;
  question_count: number;
  question_type: QuestionType;
  marks: number;
  topics: TopicInput[];
}

export interface ExamInput {
  title?: string;
  instructions?: string[];
  difficulty?: Difficulty;
  educationLevel?: EducationLevel;
  // Build questions from this indexed book ("From Source" mode).
  bookId?: string;
  sections: SectionInput[];
}

export interface ConversationTurn {
  role: "assistant" | "user";
  content: string;
}

export interface TopicSpecificInstruction {
  topic: string;
  instructions: string[];
}

export interface ConversationSummary {
  // What the exam is for, in the teacher's words (empty when not given; missing on older sessions).
  goal?: string;
  globalInstructions: string[];
  topicSpecificInstructions: TopicSpecificInstruction[];
}

export interface ConversationAgentOutput {
  sessionId: string;
  done: boolean;
  message: string;
  summary: ConversationSummary | null;
}

// Starts a new Exam Intent Agent conversation, persisted server-side. Returns
// the sessionId to pass to continueExamIntentConversation for every reply.
// `stream` receives the agent's question as it is written; the returned value is the finished reply.
export const startExamIntentConversation = async (
  examInput: ExamInput,
  stream?: ChatStreamHandlers
): Promise<ConversationAgentOutput> => {
  return streamPost<ConversationAgentOutput>("/generation-agents/conversation", { examInput }, stream);
};

// Continues an existing conversation — the server reconstructs history from
// its own stored messages, so only the sessionId and the new reply go over
// the wire.
export const continueExamIntentConversation = async (
  sessionId: string,
  message: string,
  stream?: ChatStreamHandlers
): Promise<ConversationAgentOutput> => {
  return streamPost<ConversationAgentOutput>("/generation-agents/conversation", { sessionId, message }, stream);
};

// "Skip Question" — the agent moves on to its next question without this
// one being answered. Sent as a control signal, not freeform text: the
// server substitutes its own fixed marker so the agent's behavior doesn't
// depend on exactly how the button's click is worded.
export const skipExamIntentQuestion = async (sessionId: string, stream?: ChatStreamHandlers): Promise<ConversationAgentOutput> => {
  return streamPost<ConversationAgentOutput>("/generation-agents/conversation", { sessionId, action: "skip_question" }, stream);
};

// "Skip All Questions" — ends the conversation immediately. Whatever was
// already discussed is kept; anything not yet asked is simply left out of
// the plan rather than guessed at. Always resolves with done: true — the
// server guarantees this even if the agent itself doesn't comply right away.
export const skipAllExamIntentQuestions = async (sessionId: string, stream?: ChatStreamHandlers): Promise<ConversationAgentOutput> => {
  return streamPost<ConversationAgentOutput>("/generation-agents/conversation", { sessionId, action: "skip_all" }, stream);
};

export interface AllocatedSubtopic {
  name: string;
  weight: number;
  allocatedQuestions: number;
  // Book subsection ids this subtopic comes from, for exams built from a book.
  sourceNodeIds?: string[];
}

export interface AllocatedTopic {
  topic: string;
  weight: number;
  allocatedQuestions: number;
  subtopics: AllocatedSubtopic[];
}

export interface ExamBlueprintSection {
  name: string;
  subject: string;
  topics: AllocatedTopic[];
  // Teacher topics the selected book doesn't cover.
  unmatchedTopics?: string[];
}

export interface ExamBlueprint {
  sections: ExamBlueprintSection[];
}

export type BlueprintStatus = "pending" | "in_progress" | "completed" | "failed";

export interface BlueprintStatusResponse {
  sessionId: string;
  blueprintStatus: BlueprintStatus;
  blueprint: ExamBlueprint | null;
  blueprintError: string | null;
}

export interface ExamIntentConversationState {
  sessionId: string;
  status: "in_progress" | "completed";
  history: ConversationTurn[];
  blueprintStatus: BlueprintStatus;
  blueprint: ExamBlueprint | null;
}

// Reads back a saved conversation (its messages and, once made, its plan) so the chat can be restored.
export const getExamIntentConversation = async (sessionId: string): Promise<ExamIntentConversationState> => {
  const res = await api.get(`/generation-agents/conversation/${sessionId}`);
  return res.data.data;
};

// Fires the subtopics pipeline (Inngest, one batch per section) for a
// completed intent session. Returns immediately — poll getBlueprintStatus
// for the result.
export const triggerBlueprintGeneration = async (
  sessionId: string
): Promise<{ sessionId: string; blueprintStatus: BlueprintStatus }> => {
  const res = await api.post("/generation-agents/blueprint/generate", { sessionId });
  return res.data.data;
};

export const getBlueprintStatus = async (sessionId: string): Promise<BlueprintStatusResponse> => {
  const res = await api.get(`/generation-agents/blueprint/${sessionId}`);
  return res.data.data;
};

// ── Blueprint Review Agent (chat-based refinement, alongside direct tree editing) ──

export interface BlueprintReviewTurnResult {
  sessionId: string;
  message: string;
  sections: ExamBlueprintSection[];
  done: boolean;
  changeLog: string[];
}

// `sections` should be the caller's current (possibly hand-edited) tree —
// it becomes the state the agent operates on and is persisted server-side
// either way, so direct tree edits and chat edits never diverge.
export const sendBlueprintReviewTurn = async (
  sessionId: string,
  message: string,
  sections: ExamBlueprintSection[],
  stream?: ChatStreamHandlers
): Promise<BlueprintReviewTurnResult> => {
  return streamPost<BlueprintReviewTurnResult>("/generation-agents/review/turn", { sessionId, message, sections }, stream);
};

export const getBlueprintReviewHistory = async (
  sessionId: string
): Promise<{ sessionId: string; history: ConversationTurn[]; blueprint: ExamBlueprint | null }> => {
  const res = await api.get(`/generation-agents/review/${sessionId}`);
  return res.data.data;
};

export interface BlueprintRebalanceChange {
  section: string;
  from: number;
  to: number;
  changeLog: string[];
}

// "Auto-balance": rescales every section whose total no longer matches the
// count set on the exam form, keeping its current proportions. Saved server-side.
export const rebalanceBlueprint = async (
  sessionId: string,
  sections: ExamBlueprintSection[]
): Promise<{ sections: ExamBlueprintSection[]; changes: BlueprintRebalanceChange[] }> => {
  const res = await api.post("/generation-agents/blueprint/rebalance", { sessionId, sections });
  return res.data.data;
};

// ── Question generation ──

export interface RubricCategory {
  name: string;
  weight: number;
  key_points: string[];
}

export interface Rubric {
  categories: RubricCategory[];
}

// Supplementary content shown between the question text and its options —
// mirrors the server's QuestionContentBlock (question.schema.ts).
export interface CodeContentBlock {
  type: "code";
  language: string;
  code: string;
}

// Plain text, or text plus how many columns / rows the cell covers. Each row lists only the cells that start in it.
export type TableCell = string | { text: string; colspan?: number | null; rowspan?: number | null };

export interface TableContentBlock {
  type: "table";
  headers: TableCell[];
  rows: TableCell[][];
}

// A list is plain text, one item per line ("- " bullet, "1. " number, a sub-item indented under its parent). Older lists
// were saved as separate items with one numbered / bulleted flag.
export interface ListContentBlock {
  type: "list";
  text?: string;
  ordered?: boolean;
  items?: string[];
}

export interface ImageContentBlock {
  type: "image";
  url: string;
  width: number | null;
  height: number | null;
}

export type QuestionContentBlock = CodeContentBlock | TableContentBlock | ListContentBlock | ImageContentBlock;

export interface GeneratedOption {
  text: string;
  isCode: boolean;
}

export interface MCQGeneratedQuestion {
  id: string;
  type: "mcq";
  topic: string;
  subtopic: string;
  question_text: string;
  options: GeneratedOption[];
  correct_option: "A" | "B" | "C" | "D";
  marks: number;
  content_blocks: QuestionContentBlock[];
}

export interface DescriptiveGeneratedQuestion {
  id: string;
  type: "descriptive";
  topic: string;
  subtopic: string;
  question_text: string;
  rubric: Rubric;
  marks: number;
  content_blocks: QuestionContentBlock[];
}

export type GeneratedQuestion = MCQGeneratedQuestion | DescriptiveGeneratedQuestion;

export interface GeneratedTopicQuestions {
  topic: string;
  questions: GeneratedQuestion[];
}

export interface GeneratedSectionQuestions {
  name: string;
  subject: string;
  topics: GeneratedTopicQuestions[];
}

export interface GeneratedExam {
  sections: GeneratedSectionQuestions[];
}

export type QuestionsStatus = "pending" | "in_progress" | "completed" | "failed";

export interface QuestionsStatusResponse {
  sessionId: string;
  questionsStatus: QuestionsStatus;
  questions: GeneratedExam | null;
  questionsError: string | null;
}

// Fires the question-generation pipeline (Inngest, one call per topic, run
// section by section) for a session whose blueprint is already completed.
// Returns immediately — poll getQuestionsStatus for results as sections land.
// `sections`, if given, syncs one last set of edits (e.g. from a direct tree
// editor) into the session's blueprint right before generation starts.
export const triggerQuestionGeneration = async (
  sessionId: string,
  sections?: ExamBlueprintSection[]
): Promise<{ sessionId: string; questionsStatus: QuestionsStatus }> => {
  const res = await api.post("/generation-agents/questions/generate", { sessionId, sections });
  return res.data.data;
};

export const getQuestionsStatus = async (sessionId: string): Promise<QuestionsStatusResponse> => {
  const res = await api.get(`/generation-agents/questions/${sessionId}`);
  return res.data.data;
};

export interface GenerateTopicQuestionsInput {
  subject: string;
  question_type: QuestionType;
  marks: number;
  topic: string;
  subtopics: { name: string; count: number }[];
  globalInstructions?: string[];
  topicInstructions?: string[];
  difficulty?: Difficulty;
}

export const generateTopicQuestions = async (
  input: GenerateTopicQuestionsInput
): Promise<GeneratedTopicQuestions> => {
  const res = await api.post("/generation-agents/topic/generate", input);
  return res.data.data;
};

// ── Realtime voice agents ──

export type RealtimeAgentKind = "intent" | "review" | "question_review";

export interface RealtimeSessionResponse {
  sessionId: string;
  clientSecret: string;
  model: string;
}

// Mints a short-lived OpenAI Realtime session for one agent. For "intent"
// with no sessionId, also creates the underlying session (same as starting
// a text conversation). For "review", sessionId must point to a session
// whose blueprint is already completed. For "question_review", examId must
// point to a real, already-saved exam — it operates directly on that exam's
// live questions, not a generation session.
export interface QuestionReviewTurnResult {
  examId: string;
  message: string;
  done: boolean;
  changeLog: string[];
  sections: any[];
}

// Text counterpart of the question review voice session, for plans without
// the voice agent. Same agent, same tools, same edits to the saved exam.
export const sendQuestionReviewTurn = async (
  examId: string,
  message: string,
  stream?: ChatStreamHandlers
): Promise<QuestionReviewTurnResult> => {
  return streamPost<QuestionReviewTurnResult>("/generation-agents/question-review/turn", { examId, message }, stream);
};

export const getQuestionReviewHistory = async (
  examId: string
): Promise<{ examId: string; history: ConversationTurn[] }> => {
  const res = await api.get(`/generation-agents/question-review/${examId}`);
  return res.data.data;
};

export const startRealtimeSession = async (
  agent: RealtimeAgentKind,
  opts: { sessionId?: string; examInput?: ExamInput; examId?: string } = {}
): Promise<RealtimeSessionResponse> => {
  const res = await api.post("/generation-agents/realtime/session", { agent, ...opts });
  // Callers should hide voice controls via useEntitlements() when voice is off.
  return res.data.data;
};

export const executeIntentRealtimeTool = async (
  sessionId: string,
  name: string,
  argsRaw: string
): Promise<{ output: any; summary?: ConversationSummary }> => {
  const res = await api.post("/generation-agents/realtime/intent/tool", { sessionId, name, argsRaw });
  return res.data.data;
};

export interface ReviewRealtimeToolResult {
  done: boolean;
  output: any;
  sections: ExamBlueprintSection[];
  changeLog?: string[];
  message?: string;
}

export const executeReviewRealtimeTool = async (
  sessionId: string,
  name: string,
  argsRaw: string
): Promise<ReviewRealtimeToolResult> => {
  const res = await api.post("/generation-agents/realtime/review/tool", { sessionId, name, argsRaw });
  return res.data.data;
};

export interface QuestionReviewRealtimeToolResult {
  done: boolean;
  output: any;
  // The real exam's fresh section/block/question tree (same shape
  // getSectionsWithDetailsService returns) — apply directly to the
  // builder's `sections` state, no separate refetch needed.
  sections?: any[];
  changeLog?: string[];
  message?: string;
}

export const executeQuestionReviewRealtimeTool = async (
  sessionId: string,
  name: string,
  argsRaw: string
): Promise<QuestionReviewRealtimeToolResult> => {
  const res = await api.post("/generation-agents/realtime/question-review/tool", { sessionId, name, argsRaw });
  return res.data.data;
};

export const logIntentRealtimeTurn = async (sessionId: string, role: "user" | "assistant", content: string): Promise<void> => {
  await api.post("/generation-agents/realtime/intent/log", { sessionId, role, content });
};

export const logReviewRealtimeTurn = async (sessionId: string, role: "user" | "assistant", content: string): Promise<void> => {
  await api.post("/generation-agents/realtime/review/log", { sessionId, role, content });
};
