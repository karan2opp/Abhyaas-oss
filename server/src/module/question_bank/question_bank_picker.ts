import pLimit from "p-limit";
import type { QuestionType } from "../generation_agents/Types/inputExam.js";
import type { QuestionBankDocument, QuestionBankTopicTree } from "./question_bank.schema.js";
import { getChunksByDocument } from "./question_bank.service.js";
import { rankCandidatesForGoal } from "./question_bank_ranker.js";
import { toRetrievedQuestion, type RetrievedQuestion } from "./question_bank_generator.js";
import { distinctSubtopics, flatTopicTree, subtopicsOf, topicKey } from "./question_bank_topic_tree.js";
import { assignQuestions } from "./question_bank_matching.js";

// The previous-year-question picker: a paper's broad topics -> subtopics -> how many questions from each, with counts
// that stay honest when one question belongs to two picked subtopics. See question_bank_matching.ts for the counting.

// At most this many candidates of one subtopic are given to the ranking model, so a big subtopic stays cheap.
const MAX_RANKED_CANDIDATES = 40;
const RANK_CONCURRENCY = 3;

type ChunkRow = Awaited<ReturnType<typeof getChunksByDocument>>[number];

const isMcq = (chunk: ChunkRow) => (chunk.options ?? []).length > 0;
const ofType = (chunk: ChunkRow, questionType: QuestionType) => (questionType === "mcq" ? isMcq(chunk) : !isMcq(chunk));

interface PaperQuestions {
    // Questions of the requested type that sit under at least one subtopic of the tree, in paper order.
    chunks: ChunkRow[];
    // Each question's subtopic keys (topicKey of the subtopic's name).
    subtopicsOf: Map<string, string[]>;
    subtopicName: Map<string, string>;
    broadOf: Map<string, string>;
    tree: QuestionBankTopicTree;
}

/**
 * Reads a paper's questions of one type and works out which subtopics each belongs to. A paper processed before trees
 * existed gets a flat tree built from its tags on the spot (built from all its questions, so the subtopic keys are the
 * same whichever type is asked for).
 */
async function loadPaperQuestions(document: QuestionBankDocument, questionType: QuestionType): Promise<PaperQuestions> {
    const all = await getChunksByDocument(document.id);
    const tree = document.topicTree ?? flatTopicTree(distinctSubtopics(all.map((c) => c.topics)).map((s) => s.name));

    const aliasTo = new Map<string, string>();
    const subtopicName = new Map<string, string>();
    const broadOf = new Map<string, string>();
    for (const broad of tree.broadTopics) {
        for (const sub of broad.subtopics) {
            const key = topicKey(sub.name);
            subtopicName.set(key, sub.name);
            broadOf.set(key, broad.name);
            aliasTo.set(key, key);
            for (const alias of sub.aliases) aliasTo.set(topicKey(alias), key);
        }
    }

    const subtopicsByChunk = new Map<string, string[]>();
    const chunks: ChunkRow[] = [];
    const paperOrder = [...all].sort((a, b) => a.pageStart - b.pageStart || a.createdAt.getTime() - b.createdAt.getTime());
    for (const chunk of paperOrder) {
        if (!ofType(chunk, questionType)) continue;
        const keys = [...new Set(subtopicsOf(chunk.topics).map((t) => aliasTo.get(topicKey(t))).filter((k): k is string => !!k))];
        if (keys.length === 0) continue;
        subtopicsByChunk.set(chunk.id, keys);
        chunks.push(chunk);
    }

    return { chunks, subtopicsOf: subtopicsByChunk, subtopicName, broadOf, tree };
}

export interface PaperTopicView {
    documentId: string;
    // false when the paper has no grouped tree yet and everything is under one heading.
    grouped: boolean;
    broadTopics: {
        name: string;
        // Different questions under this broad topic (a question in two of its subtopics counts once).
        total: number;
        // total: questions that can still be taken. inExam: questions of this subtopic already in the exam (only
        // counted when an exam is given; they are left out of total and of `questions`).
        subtopics: { key: string; name: string; total: number; inExam: number }[];
    }[];
    // One entry per question of the requested type: the subtopic keys it belongs to. Only this, not the questions
    // themselves, is needed to work out live counts on the client.
    questions: string[][];
}

/**
 * A paper's broad topics and subtopics, counted for one question type, as the picker shows them. `exclude`: question
 * texts (sameQuestionText) already in an exam; those questions are counted as in the exam instead of available.
 */
export async function getPaperTopicView(document: QuestionBankDocument, questionType: QuestionType, exclude?: Set<string>): Promise<PaperTopicView> {
    const paper = await loadPaperQuestions(document, questionType);
    const inExam = (chunk: ChunkRow) => !!exclude?.has(sameQuestionText(toRetrievedQuestion(chunk, "", 1).question_text));

    const available: string[][] = [];
    const totals = new Map<string, number>();
    const usedTotals = new Map<string, number>();
    for (const chunk of paper.chunks) {
        const keys = paper.subtopicsOf.get(chunk.id) ?? [];
        const counts = inExam(chunk) ? usedTotals : totals;
        for (const k of keys) counts.set(k, (counts.get(k) ?? 0) + 1);
        if (counts === totals) available.push(keys);
    }

    const broadTopics = paper.tree.broadTopics
        .map((broad) => {
            const subtopics = broad.subtopics
                .map((sub) => ({ key: topicKey(sub.name), name: sub.name, total: totals.get(topicKey(sub.name)) ?? 0, inExam: usedTotals.get(topicKey(sub.name)) ?? 0 }))
                .filter((sub) => sub.total + sub.inExam > 0);
            const keys = new Set(subtopics.map((s) => s.key));
            const total = available.filter((ks) => ks.some((k) => keys.has(k))).length;
            return { name: broad.name, total, subtopics };
        })
        .filter((broad) => broad.subtopics.length > 0);

    return {
        documentId: document.id,
        grouped: document.topicTree != null,
        broadTopics,
        questions: available,
    };
}

export interface SubtopicPick {
    documentId: string;
    // The subtopic's key, as getPaperTopicView returned it.
    subtopic: string;
    count: number;
    // Which exam section the pick is for, when the teacher builds several. Picks of different sections are filled
    // separately but from one shared pool, so a question is never used in two sections.
    section?: string | undefined;
}

export interface PickResultGroup {
    // The broad topic. Picks from different papers under broad topics of the same name share one group.
    topic: string;
    // The section the group belongs to (see SubtopicPick.section).
    section?: string | undefined;
    allocatedQuestions: number;
    questions: RetrievedQuestion[];
}

/** A question's text in the form used to spot the same question already in an exam: spacing and case ignored. */
export const sameQuestionText = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();

export interface PickShortfall {
    section?: string | undefined;
    documentId: string;
    broadTopic: string;
    subtopic: string;
    requested: number;
    found: number;
    // "not_enough": the paper doesn't have that many. "shared": it does, but some were needed by other picks.
    reason: "not_enough" | "shared";
}

/**
 * Fills the teacher's picks with REAL questions from the papers, exactly as printed.
 *
 * For each pick, its candidates are put in order of preference: by the small ranking model when the teacher gave a
 * goal and there are more candidates than wanted, otherwise questions that fit no other pick first, then paper order.
 * The candidates are then shared out (assignQuestions) so that every pick gets as many as the papers allow, a question
 * is never used twice, and within that the preference order is followed. How many come back is decided in code.
 * `exclude`: question texts (sameQuestionText) already in the exam, which are never picked again.
 */
export async function pickQuestionsFromPapers(
    input: { picks: SubtopicPick[]; goal?: string | undefined; questionType: QuestionType; marks: number; exclude?: Set<string> },
    documents: QuestionBankDocument[]
): Promise<{ groups: PickResultGroup[]; shortfalls: PickShortfall[] }> {
    const goal = input.goal?.trim() ?? "";

    // The same subtopic picked twice for the same section counts as one pick of the combined number.
    const merged = new Map<string, SubtopicPick>();
    for (const pick of input.picks) {
        const id = `${pick.section ?? ""}\u0000${pick.documentId}\u0000${topicKey(pick.subtopic)}`;
        const existing = merged.get(id);
        if (existing) existing.count += pick.count;
        else merged.set(id, { documentId: pick.documentId, subtopic: topicKey(pick.subtopic), count: pick.count, section: pick.section });
    }
    const picks = [...merged.values()];

    const papers = new Map<string, PaperQuestions>();
    for (const document of documents) {
        if (picks.some((p) => p.documentId === document.id)) papers.set(document.id, await loadPaperQuestions(document, input.questionType));
    }

    const chunkById = new Map<string, ChunkRow>();
    for (const paper of papers.values()) for (const chunk of paper.chunks) chunkById.set(chunk.id, chunk);
    const alreadyUsed = (chunk: ChunkRow) => !!input.exclude?.has(sameQuestionText(toRetrievedQuestion(chunk, "", input.marks).question_text));

    const slots = picks.map((pick) => {
        const paper = papers.get(pick.documentId);
        const candidates = paper
            ? paper.chunks.filter((c) => paper.subtopicsOf.get(c.id)!.includes(pick.subtopic) && !alreadyUsed(c)).map((c) => c.id)
            : [];
        return {
            pick,
            candidates,
            broadTopic: paper?.broadOf.get(pick.subtopic) ?? "Other",
            subtopicName: paper?.subtopicName.get(pick.subtopic) ?? pick.subtopic,
        };
    });

    // How many picks each question could serve, to put questions that only fit one pick first.
    const slotsServed = new Map<string, number>();
    for (const slot of slots) for (const id of slot.candidates) slotsServed.set(id, (slotsServed.get(id) ?? 0) + 1);

    const limit = pLimit(RANK_CONCURRENCY);
    const preferences = await Promise.all(
        slots.map((slot) =>
            limit(async () => {
                // Stable sort: within the same count, paper order is kept.
                const byExclusive = [...slot.candidates].sort((a, b) => slotsServed.get(a)! - slotsServed.get(b)!);
                if (!goal || slot.candidates.length <= slot.pick.count) return byExclusive;

                const toRank = byExclusive.slice(0, MAX_RANKED_CANDIDATES);
                const ranked = await rankCandidatesForGoal({
                    goal,
                    topic: `${slot.broadTopic} - ${slot.subtopicName}`,
                    wanted: slot.pick.count,
                    candidates: toRank.map((id) => {
                        const c = chunkById.get(id)!;
                        return { id, description: c.description || (c.questionText ?? c.rawText).slice(0, 200) };
                    }),
                });
                return [...ranked, ...byExclusive.slice(MAX_RANKED_CANDIDATES)];
            })
        )
    );

    const chosen = assignQuestions(slots.map((slot, i) => ({ demand: slot.pick.count, candidates: preferences[i]! })));

    // One group per section and broad topic name, in the order the teacher's picks first mention it.
    const groups = new Map<string, PickResultGroup>();
    const shortfalls: PickShortfall[] = [];
    slots.forEach((slot, i) => {
        const key = `${slot.pick.section ?? ""}\u0000${topicKey(slot.broadTopic)}`;
        const group = groups.get(key) ?? { topic: slot.broadTopic, section: slot.pick.section, allocatedQuestions: 0, questions: [] };
        group.allocatedQuestions += slot.pick.count;
        for (const id of chosen[i]!) group.questions.push(toRetrievedQuestion(chunkById.get(id)!, slot.subtopicName, input.marks));
        groups.set(key, group);

        const found = chosen[i]!.length;
        if (found < slot.pick.count) {
            shortfalls.push({
                section: slot.pick.section,
                documentId: slot.pick.documentId,
                broadTopic: slot.broadTopic,
                subtopic: slot.subtopicName,
                requested: slot.pick.count,
                found,
                reason: slot.candidates.length >= slot.pick.count ? "shared" : "not_enough",
            });
        }
    });

    return { groups: [...groups.values()], shortfalls };
}
