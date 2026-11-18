import api from "@/utils/axios";

export type QuestionBankDocumentStatus = "pending" | "processing" | "completed" | "failed";

export interface QuestionBankDocument {
  id: string;
  createdBy: string;
  title: string;
  fileUrl: string;
  status: QuestionBankDocumentStatus;
  totalChunks: number;
  /** 0-100 while processing, with what it is doing now, e.g. "Reading questions 16 of 50". */
  progress: number;
  progressLabel: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface QuestionBankImage {
  url: string;
  width: number | null;
  height: number | null;
  page: number;
}

export interface QuestionBankTable {
  page: number;
  header: string[] | null;
  rows: (string | null)[][];
}

export interface QuestionBankList {
  items: string[];
}

export interface QuestionBankOption {
  label: string;
  text: string;
}

export interface QuestionBankChunk {
  id: string;
  documentId: string;
  questionNumber: string | null;
  /** Verbatim extracted text, markers and all. */
  rawText: string;
  /** The stem with option/answer lines removed; null on chunks indexed before parsing existed. */
  questionText: string | null;
  options: QuestionBankOption[];
  correctOption: string | null;
  subject: string | null;
  topics: string[] | null;
  description: string | null;
  pageStart: number;
  pageEnd: number;
  images: QuestionBankImage[];
  tables: QuestionBankTable[];
  lists: QuestionBankList[];
  createdAt: string;
  updatedAt: string;
}

export interface QuestionBankSearchResult {
  score: number;
  chunk: QuestionBankChunk;
}

export async function uploadQuestionBankDocument(
  file: File,
  title?: string
): Promise<{ documentId: string; status: QuestionBankDocumentStatus }> {
  const formData = new FormData();
  formData.append("file", file);
  if (title?.trim()) formData.append("title", title.trim());
  const res = await api.post("/question-bank/documents", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return res.data.data;
}

export async function listQuestionBankDocuments(): Promise<QuestionBankDocument[]> {
  const res = await api.get("/question-bank/documents");
  return res.data.data;
}

export async function getQuestionBankDocument(documentId: string): Promise<QuestionBankDocument> {
  const res = await api.get(`/question-bank/documents/${documentId}`);
  return res.data.data;
}

export async function renameQuestionBankDocument(documentId: string, title: string): Promise<QuestionBankDocument> {
  const res = await api.patch(`/question-bank/documents/${documentId}`, { title });
  return res.data.data;
}

export async function deleteQuestionBankDocument(documentId: string): Promise<void> {
  await api.delete(`/question-bank/documents/${documentId}`);
}

export async function searchQuestionBank(query: string, options: { subject?: string; topics?: string[]; limit?: number } = {}): Promise<QuestionBankSearchResult[]> {
  const res = await api.post("/question-bank/search", { query, ...options });
  return res.data.data;
}

export type QuestionType = "mcq" | "descriptive";
export type Difficulty = "easy" | "medium" | "hard";
export type TopicTier = "high" | "mid" | "low";

/**
 * A real question from an uploaded paper, returned exactly as extracted.
 * Nothing here is model-written — `correct_option` is the positional letter
 * of the right choice, so it lines up with the options array by index.
 */
export interface GeneratedQuestion {
  id: string;
  type: QuestionType;
  topic: string;
  question_text: string;
  marks: number;
  options?: string[];
  correct_option?: string;
  /** Figures from the paper (images), in order. */
  content_blocks?: { type: "image"; url: string; width: number | null; height: number | null }[];
  source: {
    documentId: string;
    questionNumber: string | null;
    pageStart: number;
  };
}

export interface GeneratedTopicGroup {
  topic: string;
  /** The exam section it was picked for, when several sections are built at once (SubtopicPick.section). */
  section?: string;
  /** What was asked for; questions.length is what the documents actually had. */
  allocatedQuestions: number;
  questions: GeneratedQuestion[];
}

/** One topic the teacher picked, and how many questions they want from it. */
export interface PickedTopicInput {
  topic: string;
  count: number;
  /** true when picked from the list of topics found in the papers, false when typed (matched by meaning). */
  fromPapers: boolean;
}

export interface GenerateFromDocumentsInput {
  documentIds: string[];
  topics: PickedTopicInput[];
  /** What the exam is for. Used to choose between questions when a topic has more matches than wanted. */
  goal?: string;
  questionType: QuestionType;
  marks: number;
}

/** A topic found in the selected papers, with how many questions of each type it has. */
export interface PaperTopic {
  topic: string;
  mcq: number;
  descriptive: number;
}

export async function listPaperTopics(documentIds: string[]): Promise<PaperTopic[]> {
  const res = await api.get("/question-bank/topics", { params: { documentIds: documentIds.join(",") } });
  return res.data.data;
}

export async function generateQuestionsFromDocuments(input: GenerateFromDocumentsInput): Promise<GeneratedTopicGroup[]> {
  const res = await api.post("/question-bank/generate", input);
  return res.data.data.groups;
}

// ── Topic picker: a paper's broad topics -> subtopics -> how many from each ──

export interface PaperSubtopic {
  /** Sent back in a pick to name this subtopic. */
  key: string;
  name: string;
  /** Questions of the requested type under this subtopic (not counting those already in the exam, when one is given). */
  total: number;
  /** Questions of this subtopic already in the exam. Only when the tree was asked for an exam. */
  inExam?: number;
}

export interface PaperBroadTopic {
  name: string;
  /** Different questions under this broad topic (a question in two of its subtopics counts once). */
  total: number;
  subtopics: PaperSubtopic[];
}

export interface PaperTopicTree {
  documentId: string;
  /** false when the paper has not been grouped into broad topics yet, so everything is under one heading. */
  grouped: boolean;
  broadTopics: PaperBroadTopic[];
  /** One entry per question: the subtopic keys it belongs to. Used to work out live counts. */
  questions: string[][];
}

/** With `examId`, questions already in that exam are left out of the counts (and counted in `inExam`). */
export async function getPaperTopicTree(documentId: string, questionType: QuestionType, examId?: string): Promise<PaperTopicTree> {
  const res = await api.get(`/question-bank/documents/${documentId}/topics`, { params: { questionType, ...(examId ? { examId } : {}) } });
  return res.data.data;
}

/** How many questions to take from one subtopic of one paper. */
export interface SubtopicPick {
  documentId: string;
  subtopic: string;
  count: number;
  /** Which exam section the pick is for. Sections are filled from one shared pool, so a question is used only once. */
  section?: string;
}

export interface PickShortfall {
  section?: string;
  documentId: string;
  broadTopic: string;
  subtopic: string;
  requested: number;
  found: number;
  /** not_enough: the paper doesn't have that many. shared: it does, but some were needed by other picks. */
  reason: "not_enough" | "shared";
}

export async function pickQuestionsFromPapers(input: {
  picks: SubtopicPick[];
  goal?: string;
  questionType: QuestionType;
  marks: number;
}): Promise<{ groups: GeneratedTopicGroup[]; shortfalls: PickShortfall[] }> {
  const res = await api.post("/question-bank/pick", input);
  return res.data.data;
}
