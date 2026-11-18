import type { ExtractPdfResult, ExtractedTable } from "../../common/pdf/pdf_python_bridge.js";
import type { QuestionBankRawChunk } from "./question_bank_chunker.js";

/**
 * Answer keys printed as a block at the END of a paper, rather than inline
 * under each question.
 *
 * The classifier only ever sees one question's chunk, so it can never find an
 * answer that lives on a separate page — it correctly returns null for every
 * question and the whole key is lost. This is a document-level pass that runs
 * before classification and hands the pipeline a number -> label map to fill
 * those nulls in from.
 *
 * Deliberately mechanical, no model involved: the key is already unambiguous
 * text ("12. B"), and a model could only make it worse by guessing.
 */

// One "12. B" (or "12 (B)") pair occupying an ENTIRE cell or token — anchored on
// both ends on purpose. A loose search would match the "33. A" inside "Q33. A /26
// subnet mask provides...", turning a question's own text into a fake answer.
const ANSWER_PAIR = /^\s*(\d{1,3})\s*[.)\-:]?\s*\(?([A-Ha-h])\)?\s*$/;

// How many valid pairs a table or line needs before it is treated as a key.
// Two could be coincidence; three in a row is a deliberate list.
const MIN_PAIRS = 3;

const pairFrom = (text: string): [string, string] | null => {
    const m = text.match(ANSWER_PAIR);
    if (!m) return null;
    return [String(parseInt(m[1]!, 10)), m[2]!.toUpperCase()];
};

/** A line like "1. B  2. C  3. B  4. B  5. B" — only pairs, nothing else. */
const pairsFromLine = (text: string): [string, string][] => {
    // "12. Option B" reads the same as "12. B".
    const tokens = text.replace(/\boption\b/gi, " ").split(/[\s,;|]+/).filter(Boolean);
    const pairs: [string, string][] = [];

    // Tokens arrive either glued ("12.B") or split across two ("12." + "B"),
    // depending on how the PDF spaced them.
    for (let i = 0; i < tokens.length; i++) {
        const direct = pairFrom(tokens[i]!);
        if (direct) {
            pairs.push(direct);
            continue;
        }
        const joined = pairFrom(`${tokens[i]} ${tokens[i + 1] ?? ""}`);
        if (joined) {
            pairs.push(joined);
            i++;
            continue;
        }
        // Anything that isn't part of a pair disqualifies the whole line —
        // this is an answer key row or it is prose, never a mix.
        return [];
    }

    return pairs;
};

const pairsFromTable = (table: ExtractedTable): [string, string][] => {
    const cells = [...(table.header ?? []), ...table.rows.flat()].filter(
        (c): c is string => typeof c === "string" && c.trim() !== ""
    );

    const pairs: [string, string][] = [];
    for (const cell of cells) {
        const pair = pairFrom(cell) ?? (pairsFromLine(cell).length === 1 ? pairsFromLine(cell)[0]! : null);
        if (!pair) return [];
        pairs.push(pair);
    }
    return pairs;
};

/** Whether this table is an answer key (and so not content of any question). */
export function isAnswerKeyTable(table: ExtractedTable): boolean {
    return pairsFromTable(table).length >= MIN_PAIRS;
}

/** Whether this line is an answer key row (and so not part of a question). */
export function isAnswerKeyLine(text: string): boolean {
    return pairsFromLine(text).length >= MIN_PAIRS;
}

export interface AnswerKeyEntry {
    // The question number the key gives the answer for, digits only.
    number: string;
    // The answer exactly as the key prints it ("B", "(b)", "2"); turned into one of the question's own option labels
    // by resolveAnswerLabel.
    answer: string;
    // A heading the key printed above the entry ("Part A", "Section 2"), when there is one.
    section?: string | null;
}

/** One list of answers from the key, in printed order. A paper whose numbering restarts has one block per part. */
export type AnswerKeyBlock = AnswerKeyEntry[];

/**
 * Cuts a flat list of key entries (in printed order) into blocks. A new block starts when the numbers go back down
 * ("... 19. C 20. A" then "1. B") or the heading changes.
 */
export function splitIntoBlocks(entries: AnswerKeyEntry[]): AnswerKeyBlock[] {
    const blocks: AnswerKeyBlock[] = [];
    let lastNumber = Infinity;
    let lastSection: string | null = null;

    for (const entry of entries) {
        const number = parseInt(entry.number, 10);
        if (!Number.isFinite(number)) continue;
        const section = entry.section?.trim() || null;

        const restarted = number <= lastNumber && blocks.length > 0;
        const headingChanged = section !== null && lastSection !== null && section.toLowerCase() !== lastSection.toLowerCase();
        if (blocks.length === 0 || restarted || headingChanged) blocks.push([]);

        blocks[blocks.length - 1]!.push({ number: String(number), answer: entry.answer, section });
        lastNumber = number;
        if (section) lastSection = section;
    }

    return blocks;
}

/**
 * Scans a whole extracted document for an end-of-paper answer key the pattern reader fully recognises.
 * Returns the key as blocks in printed order, empty when the paper has none (or only formats it can't read — the
 * classifier pass picks those up).
 */
export function parseAnswerKey(extracted: ExtractPdfResult): AnswerKeyBlock[] {
    const entries: AnswerKeyEntry[] = [];

    for (const page of extracted.pages) {
        for (const table of page.tables) {
            const pairs = pairsFromTable(table);
            if (pairs.length >= MIN_PAIRS) for (const [number, answer] of pairs) entries.push({ number, answer });
        }
        for (const line of page.lines) {
            const pairs = pairsFromLine(line.text);
            if (pairs.length >= MIN_PAIRS) for (const [number, answer] of pairs) entries.push({ number, answer });
        }
    }

    return splitIntoBlocks(entries);
}

/**
 * Which part of the paper each question is in: 0 for the first run of numbers, 1 once the numbering starts again
 * ("... 20" then "1"), and so on. A paper that numbers straight through is all part 0.
 */
function partsOfQuestions(numbers: (string | null)[]): number[] {
    let part = 0;
    let last = 0;
    return numbers.map((raw) => {
        const n = raw ? parseInt(raw, 10) : NaN;
        if (Number.isFinite(n)) {
            if (n <= last) part++;
            last = n;
        }
        return part;
    });
}

/**
 * Gives every question its answer from the key, by question number. When the question numbers restart (Part A 1-20,
 * Part B 1-20) the key has to restart the same number of times, and part N of the key goes to part N of the questions.
 * If the counts don't agree it is not safe to guess which answer belongs where, so nothing is assigned.
 *
 * Returns one entry per question (undefined = no answer), plus whether the key could be used at all.
 */
export function matchKeyToQuestions(
    questionNumbers: (string | null)[],
    blocks: AnswerKeyBlock[]
): { answers: (string | undefined)[]; usable: boolean } {
    const none = questionNumbers.map(() => undefined);
    if (blocks.length === 0 || questionNumbers.length === 0) return { answers: none, usable: false };

    const parts = partsOfQuestions(questionNumbers);
    const partCount = Math.max(...parts) + 1;

    const lookups: Map<string, string>[] = [];
    if (partCount === 1) {
        // Numbered straight through: every block belongs to the same run, later entries win.
        const all = new Map<string, string>();
        for (const block of blocks) for (const entry of block) all.set(entry.number, entry.answer);
        lookups.push(all);
    } else {
        if (blocks.length !== partCount) return { answers: none, usable: false };
        for (const block of blocks) lookups.push(new Map(block.map((entry) => [entry.number, entry.answer] as const)));
    }

    const answers = questionNumbers.map((raw, i) => {
        const n = raw ? parseInt(raw, 10) : NaN;
        return Number.isFinite(n) ? lookups[partCount === 1 ? 0 : parts[i]!]?.get(String(n)) : undefined;
    });
    return { answers, usable: true };
}

const cleanAnswer = (raw: string) => raw.replace(/^\s*(?:option|ans(?:wer)?\.?)\s*[:\-]?\s*/i, "").replace(/[\s()[\].:,;]/g, "");

/**
 * Turns an answer as the key prints it into one of the question's own option labels, or null. The key's answer has to
 * match an option that really exists. It matches the label itself ("b" -> "B"); when the options are labelled
 * (i)/(ii)/(iii) or 1/2/3 but the key uses letters, a letter is taken as the option's position (B = second option).
 */
export function resolveAnswerLabel(answer: string, optionLabels: string[]): string | null {
    const wanted = cleanAnswer(answer).toLowerCase();
    if (!wanted || optionLabels.length === 0) return null;

    const byLabel = optionLabels.find((label) => cleanAnswer(label).toLowerCase() === wanted);
    if (byLabel) return byLabel;

    const labelsAreLetters = optionLabels.every((label) => /^[a-h]$/i.test(cleanAnswer(label)));
    if (!labelsAreLetters && /^[a-h]$/.test(wanted)) {
        return optionLabels[wanted.charCodeAt(0) - 97] ?? null;
    }
    return null;
}

/**
 * Removes answer-key content from a chunk. The key sits after the last
 * question marker, so the chunker attaches all of it to the final question —
 * which would otherwise carry the entire key as its own table and text.
 */
export function stripAnswerKeyContent(chunk: QuestionBankRawChunk): QuestionBankRawChunk {
    return {
        ...chunk,
        rawText: chunk.rawText
            .split("\n")
            .filter((line) => !isAnswerKeyLine(line))
            .join("\n")
            .trim(),
        tables: chunk.tables.filter((table) => !isAnswerKeyTable(table)),
    };
}
