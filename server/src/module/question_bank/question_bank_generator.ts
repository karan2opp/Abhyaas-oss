import { and, asc, inArray, notInArray, sql } from "drizzle-orm";
import db from "../../common/db/index.js";
import { questionBankChunks } from "./question_bank.schema.js";
import type { QuestionType } from "../generation_agents/Types/inputExam.js";
import { searchQuestionBank } from "./question_bank.service.js";
import type { QuestionBankAccess } from "./qdrant_client.js";
import type { QuestionContentBlock } from "../questions/question.schema.js";
import { rankCandidatesForGoal } from "./question_bank_ranker.js";

// For every question wanted, this many candidates are looked at, so the best fit can be chosen from a few instead of
// taking the first ones blindly. Capped so a large request stays cheap.
const CANDIDATES_PER_QUESTION = 3;
const MAX_CANDIDATES = 40;

export interface PickedTopic {
    topic: string;
    count: number;
    // true: the topic was picked from the list of topics found in the papers, so it is matched on that saved tag.
    // false: the teacher typed it, so it is matched by meaning.
    fromPapers: boolean;
}

export interface GenerateFromDocumentsInput {
    documentIds: string[];
    topics: PickedTopic[];
    // What the exam is for. Only used to choose between questions when a topic has more candidates than wanted.
    goal?: string | undefined;
    questionType: QuestionType;
    marks: number;
}

export interface RetrievedQuestion {
    // The chunk's own id — stable, and the Qdrant point id for the same row.
    id: string;
    type: QuestionType;
    topic: string;
    question_text: string;
    marks: number;
    options?: string[];
    correct_option?: string;
    // Figures from the paper that the question refers to, in the order they appear.
    content_blocks: QuestionContentBlock[];
    // Where this question actually came from, so a teacher can check it
    // against the original paper.
    source: {
        documentId: string;
        questionNumber: string | null;
        pageStart: number;
    };
}

export interface RetrievedTopicGroup {
    topic: string;
    allocatedQuestions: number;
    questions: RetrievedQuestion[];
}

type ChunkRow = typeof questionBankChunks.$inferSelect;

// Papers print the marks beside each question, as "[1 mark]" or "(2 Marks)". It is not part of the question, and the exam
// sets its own marks, so it is removed here. Done in code rather than by the AI so it is exact and also covers papers
// uploaded earlier. Only brackets containing "mark(s)" are touched, never a bare "(5 m)" which could be a length.
const PRINTED_MARKS_RE = /[ \t]*[\[(]\s*(?:\d+(?:\.\d+)?\s*(?:marks?|mks?)|marks?\s*[:=\-]?\s*\d+(?:\.\d+)?)\s*[\])]/gi;
const stripPrintedMarks = (text: string) => text.replace(PRINTED_MARKS_RE, "").trim();

const POSITIONAL_LABELS = ["A", "B", "C", "D", "E", "F", "G", "H"];

/**
 * Maps one stored chunk onto the response shape. Options are returned as
 * plain strings in printed order and the answer becomes the POSITIONAL letter
 * of the correct option, because that is what the UI matches against — a
 * paper labelled (i)/(ii)/(iii) would otherwise never line up.
 */
function toRetrievedQuestion(chunk: ChunkRow, topic: string, marks: number): RetrievedQuestion {
    const options = chunk.options ?? [];
    const base = {
        id: chunk.id,
        topic,
        question_text: stripPrintedMarks(chunk.questionText || chunk.rawText),
        marks,
        content_blocks: (chunk.images ?? []).map((img): QuestionContentBlock => ({ type: "image", url: img.url, width: img.width, height: img.height })),
        source: {
            documentId: chunk.documentId,
            questionNumber: chunk.questionNumber,
            pageStart: chunk.pageStart,
        },
    };

    if (options.length === 0) {
        return { ...base, type: "descriptive" };
    }

    const answerIndex = chunk.correctOption
        ? options.findIndex((o) => o.label.toUpperCase() === chunk.correctOption!.toUpperCase())
        : -1;

    return {
        ...base,
        type: "mcq",
        options: options.map((o) => o.text),
        ...(answerIndex >= 0 && answerIndex < POSITIONAL_LABELS.length
            ? { correct_option: POSITIONAL_LABELS[answerIndex]! }
            : {}),
    };
}

const candidatePoolSize = (count: number) => Math.max(Math.min(count * CANDIDATES_PER_QUESTION, MAX_CANDIDATES), count);

// MCQ means the question's options were parsed out; otherwise it is a written answer.
const isMcqSql = sql`jsonb_array_length(coalesce(${questionBankChunks.options}, '[]'::jsonb)) > 0`;
const isDescriptiveSql = sql`jsonb_array_length(coalesce(${questionBankChunks.options}, '[]'::jsonb)) = 0`;

/** Questions whose saved topic tag is this topic (ignoring capitals), in the order they appear in the papers. */
async function candidatesFromTag(
    topic: string,
    documentIds: string[],
    questionType: QuestionType,
    taken: Set<string>,
    limit: number
): Promise<ChunkRow[]> {
    const conditions = [
        inArray(questionBankChunks.documentId, documentIds),
        sql`exists (select 1 from unnest(${questionBankChunks.topics}) as tag where lower(btrim(tag)) = ${topic.trim().toLowerCase()})`,
        questionType === "mcq" ? isMcqSql : isDescriptiveSql,
    ];
    if (taken.size > 0) conditions.push(notInArray(questionBankChunks.id, [...taken]));

    return db
        .select()
        .from(questionBankChunks)
        .where(and(...conditions))
        .orderBy(asc(questionBankChunks.documentId), asc(questionBankChunks.pageStart), asc(questionBankChunks.createdAt))
        .limit(limit);
}

/** Questions closest in meaning to a topic the teacher typed, closest first. */
async function candidatesFromMeaning(
    topic: string,
    documentIds: string[],
    questionType: QuestionType,
    taken: Set<string>,
    limit: number,
    access: QuestionBankAccess
): Promise<ChunkRow[]> {
    // The search can't skip questions an earlier topic took, so ask for that many extra.
    const hits = await searchQuestionBank(topic, access, { documentIds, questionType, limit: limit + taken.size });
    return hits
        .map((hit) => hit.chunk)
        .filter((chunk) => !taken.has(chunk.id))
        .slice(0, limit);
}

/**
 * Returns REAL questions from the selected papers, exactly as printed, for each topic the teacher picked and the number
 * they asked for.
 *
 * Topics picked from the papers' own list are matched on the saved topic tag; topics the teacher typed are matched by
 * meaning. When a topic has more candidates than wanted and the teacher said what the exam is for, a small model ranks
 * the candidates by fit and the best ones are kept. The model only reorders the list it was given. How many come back is
 * decided here, in code: never more than asked for, and fewer only when the papers don't have enough.
 */
export async function generateQuestionsFromDocuments(
    input: GenerateFromDocumentsInput,
    access: QuestionBankAccess
): Promise<RetrievedTopicGroup[]> {
    if (input.documentIds.length === 0) throw new Error("At least one document must be selected");
    if (input.topics.length === 0) throw new Error("At least one topic must be picked");

    const goal = input.goal?.trim() ?? "";

    // Sequential, not parallel: each topic has to see what earlier topics already took, or the same question comes
    // back under two topics.
    const taken = new Set<string>();
    const groups: RetrievedTopicGroup[] = [];
    const seenTopics = new Set<string>();

    for (const picked of input.topics) {
        const key = picked.topic.trim().toLowerCase();
        if (!key || seenTopics.has(key)) continue;
        seenTopics.add(key);

        const pool = candidatePoolSize(picked.count);
        const candidates = picked.fromPapers
            ? await candidatesFromTag(picked.topic, input.documentIds, input.questionType, taken, pool)
            : await candidatesFromMeaning(picked.topic, input.documentIds, input.questionType, taken, pool, access);

        let chosen = candidates.slice(0, picked.count);
        if (goal && candidates.length > picked.count) {
            const order = await rankCandidatesForGoal({
                goal,
                topic: picked.topic,
                wanted: picked.count,
                candidates: candidates.map((c) => ({ id: c.id, description: c.description || (c.questionText ?? c.rawText).slice(0, 200) })),
            });
            const byId = new Map(candidates.map((c) => [c.id, c]));
            chosen = order
                .slice(0, picked.count)
                .map((id) => byId.get(id))
                .filter((c): c is ChunkRow => !!c);
        }

        for (const chunk of chosen) taken.add(chunk.id);
        groups.push({
            topic: picked.topic,
            allocatedQuestions: picked.count,
            questions: chosen.map((chunk) => toRetrievedQuestion(chunk, picked.topic, input.marks)),
        });
    }

    return groups;
}

export interface PaperTopic {
    topic: string;
    mcq: number;
    descriptive: number;
}

/**
 * The topics found in the selected papers, with how many multiple-choice and written questions each has. Read from the
 * tags saved when the papers were processed, so it costs nothing.
 */
export async function listTopicsForDocuments(documentIds: string[]): Promise<PaperTopic[]> {
    if (documentIds.length === 0) return [];
    const rows = await db
        .select({ topics: questionBankChunks.topics, options: questionBankChunks.options })
        .from(questionBankChunks)
        .where(inArray(questionBankChunks.documentId, documentIds));

    const byTopic = new Map<string, PaperTopic>();
    for (const row of rows) {
        const isMcq = (row.options ?? []).length > 0;
        const seen = new Set<string>();
        for (const raw of row.topics ?? []) {
            const topic = raw.trim();
            const key = topic.toLowerCase();
            if (!topic || seen.has(key)) continue;
            seen.add(key);
            const entry = byTopic.get(key) ?? { topic, mcq: 0, descriptive: 0 };
            if (isMcq) entry.mcq++;
            else entry.descriptive++;
            byTopic.set(key, entry);
        }
    }

    return [...byTopic.values()].sort((a, b) => b.mcq + b.descriptive - (a.mcq + a.descriptive) || a.topic.localeCompare(b.topic));
}

/**
 * Every question in the selected documents, unfiltered — the fallback for a
 * caller that wants the whole bank rather than a topic-weighted selection.
 */
export async function listQuestionsForDocuments(documentIds: string[], marks: number): Promise<RetrievedQuestion[]> {
    if (documentIds.length === 0) return [];
    const rows = await db.select().from(questionBankChunks).where(inArray(questionBankChunks.documentId, documentIds));
    return rows.map((row) => toRetrievedQuestion(row, (row.topics ?? [])[0] ?? "General", marks));
}
