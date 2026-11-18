import { z } from "zod";
import { zodResponseFormat } from "openai/helpers/zod";
import pLimit from "p-limit";
import type { ExtractPdfResult } from "../../common/pdf/pdf_python_bridge.js";
import { getClientForModel } from "../../common/agent/openai.client.js";
import { BadAiReplyError, withAiRetry } from "../../common/agent/ai_retry.js";
import { env } from "../../env.js";
import { getQuestionBankSplitterSystemPrompt } from "../../prompts/question_bank_splitter.prompt.js";
import { findCodeLines, orderedLines, QUESTION_MARKER_RE, type LineRole } from "./question_bank_chunker.js";
import type { AnswerKeyEntry } from "./question_bank_answer_key.js";

// Splitting a past paper into questions with a fast model. The model reads a few pages at a time as numbered lines
// and says only where each part starts and what it is (question, page header, answer key, ...). It never writes
// question text: the text, figures and tables are cut out of the PDF by code (question_bank_chunker.ts), so every
// question stays exactly as printed.

// How many groups of pages are with the model at once.
const SPLIT_CONCURRENCY = 5;
// Lines of the neighbouring pages shown as read-only context, so the model can see how a question carries on.
const NEXT_CONTEXT_LINES = 15;
const PREVIOUS_CONTEXT_LINES = 5;
const SPLIT_TIMEOUT_MS = 120_000;

const PartKind = z.enum(["question", "continuation", "header_footer", "heading", "answer_key", "model_answer", "shared_passage"]);

const SplitPartZodSchema = z.object({
    start: z.string().describe('The first line of this part, as "page.line".'),
    kind: PartKind,
    number: z.string().nullable().describe("For a question: its printed number, digits only. Otherwise null."),
    covers: z.array(z.string()).describe("For a shared_passage: the question numbers it is for. Otherwise empty."),
});

const AnswerKeyZodSchema = z.array(
    z.object({
        section: z.string().nullable(),
        number: z.string(),
        answer: z.string(),
    })
);

type Page = ExtractPdfResult["pages"][number];

const pageField = (page: Page) => `page_${page.page}`;

/**
 * The reply's shape for one group: a required list of parts for EACH page sent ("page_4", "page_5", ...), so the model
 * can't return a reply that silently stops after the first page.
 */
function splitReplySchema(pages: Page[]) {
    return z.object({
        ...Object.fromEntries(
            pages.map((page) => [pageField(page), z.array(SplitPartZodSchema).describe(`Every part on page ${page.page}, top to bottom. Never empty.`)])
        ),
        answerKey: AnswerKeyZodSchema,
    });
}

// One group's reply with the pages' parts in one list, in page order.
interface SplitReply {
    parts: z.infer<typeof SplitPartZodSchema>[];
    answerKey: z.infer<typeof AnswerKeyZodSchema>;
}

// Kinds whose lines may legitimately start with "Q12." without being a new question.
const KINDS_HOLDING_Q_LINES = new Set<CheckedPart["kind"]>(["answer_key", "model_answer", "heading"]);

export interface SplitPlan {
    // What each line is, keyed "page.line" — see chunkByPlan.
    roles: Map<string, LineRole>;
    // The answer key entries the model read, in printed order.
    answerKey: AnswerKeyEntry[];
    questionCount: number;
}

const digitsOnly = (s: string | null | undefined) => {
    const m = (s ?? "").match(/\d{1,3}/);
    return m ? String(parseInt(m[0], 10)) : null;
};

// Which lines are program code, by page (see findCodeLines).
type CodeLines = Map<number, Set<number>>;

function renderLines(page: Page, from: number, to: number, codeLines: CodeLines): string {
    return orderedLines(page)
        .slice(from, to)
        .map((line, i) => `${page.page}.${from + i + 1}| ${codeLines.get(page.page)?.has(from + i) ? "[code] " : ""}${line.text}`)
        .join("\n");
}

/** The text sent for one group: its pages in full, with a few lines of the pages either side marked as context. */
function groupPrompt(pages: Page[], previous: Page | undefined, next: Page | undefined, codeLines: CodeLines): string {
    const parts: string[] = [];
    if (previous) {
        const count = orderedLines(previous).length;
        parts.push(`CONTEXT ONLY — end of page ${previous.page} (do not label):\n${renderLines(previous, Math.max(0, count - PREVIOUS_CONTEXT_LINES), count, codeLines)}`);
    }
    for (const page of pages) {
        parts.push(`PAGE ${page.page} — label these lines:\n${renderLines(page, 0, orderedLines(page).length, codeLines)}`);
    }
    if (next) {
        parts.push(`CONTEXT ONLY — start of page ${next.page} (do not label):\n${renderLines(next, 0, NEXT_CONTEXT_LINES, codeLines)}`);
    }
    return parts.join("\n\n");
}

export interface CheckedPart {
    page: number;
    line: number;
    kind: z.infer<typeof PartKind>;
    number: string | null;
    covers: string[];
}

/**
 * Keeps only parts that start on a real line of one of this group's own pages, in reading order, one per line. The
 * reply is treated as bad, and asked for again, when it leaves out questions:
 *   - a page has no part at all (the model stopped early, as on a JS paper where only page 1 of 3 was labelled), or
 *   - a line that opens with a question marker ("Q12.") is not marked as a question start and ends up inside another
 *     question (the model skipped it), or after the last part of a page of questions (the model stopped early). Such
 *     lines are fine inside an answer key, model answers or a heading, and inside whatever carries those on. Code lines
 *     ("q1 = 5") are never taken for a question marker.
 */
export function checkReply(reply: SplitReply, pages: Page[], codeLines: CodeLines = new Map()): CheckedPart[] {
    const parts = keepUsableParts(reply, pages);

    for (const page of pages) {
        if (!parts.some((part) => part.page === page.page)) throw new BadAiReplyError(`no parts for page ${page.page}`);
    }

    // Walk the lines in order, keeping track of which part each one falls in and, as buildPlan does, what carrying on
    // means there. At the top of the group that depends on the previous group, which this reply can't see.
    let current = -1;
    let carryOn: "continue" | "close" | "unknown" = "unknown";
    for (const page of pages) {
        orderedLines(page).forEach((line, i) => {
            const lineNo = i + 1;
            while (current + 1 < parts.length && (parts[current + 1]!.page < page.page || (parts[current + 1]!.page === page.page && parts[current + 1]!.line <= lineNo))) {
                const kind = parts[++current]!.kind;
                if (kind === "question") carryOn = "continue";
                else if (kind !== "continuation" && kind !== "header_footer") carryOn = "close";
            }
            if (!QUESTION_MARKER_RE.test(line.text) || codeLines.get(page.page)?.has(i)) return;
            const part = parts[current];
            const ok =
                !!part &&
                ((part.kind === "question" && part.page === page.page && part.line === lineNo) ||
                    KINDS_HOLDING_Q_LINES.has(part.kind) ||
                    ((part.kind === "continuation" || part.kind === "header_footer") && carryOn !== "continue"));
            if (!ok) throw new BadAiReplyError(`line ${page.page}.${lineNo} ("${line.text.trim().slice(0, 20)}") is not marked as a question`);
        });
    }
    return parts;
}

function keepUsableParts(reply: SplitReply, pages: Page[]): CheckedPart[] {
    const lineCounts = new Map(pages.map((p) => [p.page, orderedLines(p).length]));
    const seen = new Set<string>();
    const parts: CheckedPart[] = [];
    for (const part of reply.parts) {
        const m = part.start.trim().match(/^(\d+)\.(\d+)$/);
        if (!m) continue;
        const page = parseInt(m[1]!, 10);
        const line = parseInt(m[2]!, 10);
        const count = lineCounts.get(page);
        if (count === undefined || line < 1 || line > count || seen.has(`${page}.${line}`)) continue;
        seen.add(`${page}.${line}`);
        parts.push({
            page,
            line,
            kind: part.kind,
            number: part.kind === "question" ? digitsOnly(part.number) : null,
            covers: part.kind === "shared_passage" ? part.covers.map(digitsOnly).filter((n): n is string => !!n) : [],
        });
    }
    return parts.sort((a, b) => a.page - b.page || a.line - b.line);
}

async function splitGroup(pages: Page[], previous: Page | undefined, next: Page | undefined, codeLines: CodeLines, label: string) {
    const client = await getClientForModel(env.QUESTION_SPLIT_MODEL, "question_bank_split");
    const schema = splitReplySchema(pages);
    return withAiRetry(label, async () => {
        const response = await client.chat.completions.create(
            {
                model: env.QUESTION_SPLIT_MODEL,
                messages: [
                    { role: "system", content: getQuestionBankSplitterSystemPrompt() },
                    { role: "user", content: groupPrompt(pages, previous, next, codeLines) },
                ],
                response_format: zodResponseFormat(schema, "paper_parts"),
            },
            { maxRetries: 0, timeout: SPLIT_TIMEOUT_MS }
        );
        const parsed = schema.parse(JSON.parse(response.choices[0]?.message.content || "{}")) as Record<string, unknown>;
        const reply: SplitReply = {
            parts: pages.flatMap((page) => parsed[pageField(page)] as SplitReply["parts"]),
            answerKey: parsed.answerKey as SplitReply["answerKey"],
        };
        return { parts: checkReply(reply, pages, codeLines), answerKey: reply.answerKey };
    });
}

/**
 * Splits a whole extracted paper: groups of QUESTION_SPLIT_PAGES_PER_CALL pages go to the model in parallel, and their
 * answers are joined into one plan in reading order. Throws if any group still fails after its retries — the caller
 * then falls back to the old split for the whole paper, since mixing the two inside one paper would be fragile.
 */
export async function splitPaper(
    extracted: ExtractPdfResult,
    documentId: string,
    // Called as each group of pages comes back, for the progress bar.
    onProgress?: (done: number, total: number) => void
): Promise<SplitPlan> {
    const groups = groupPages(extracted, env.QUESTION_SPLIT_PAGES_PER_CALL);
    const codeLines = findCodeLines(extracted);
    const limit = pLimit(SPLIT_CONCURRENCY);
    let done = 0;
    const replies = await Promise.all(
        groups.map((group, g) =>
            limit(() => {
                const previous = groups[g - 1]?.at(-1);
                const next = groups[g + 1]?.[0];
                return splitGroup(group, previous, next, codeLines, `split ${documentId} pages ${group[0]!.page}-${group.at(-1)!.page}`).then((reply) => {
                    onProgress?.(++done, groups.length);
                    return reply;
                });
            })
        )
    );
    return buildPlan(groups, replies);
}

/** The paper's pages that have text, in groups of `size` for the splitting calls. */
export function groupPages(extracted: ExtractPdfResult, size: number): Page[][] {
    const pages = extracted.pages.filter((p) => orderedLines(p).length > 0);
    const groups: Page[][] = [];
    for (let i = 0; i < pages.length; i += size) groups.push(pages.slice(i, i + size));
    return groups;
}

/** Joins the checked replies of every group into one plan for the whole paper, in reading order. */
export function buildPlan(groups: Page[][], replies: { parts: CheckedPart[]; answerKey: SplitReply["answerKey"] }[]): SplitPlan {
    const roles = new Map<string, LineRole>();
    const answerKey: AnswerKeyEntry[] = [];
    // Question numbers a shared passage introduced and that haven't been met yet. The next question with one of these
    // numbers depends on the passage, which isn't kept, so that question is left out.
    const coveredByPassage = new Set<string>();
    let questionCount = 0;
    // What "carrying on" means at this point of the paper: more of the current question ("continue"), or more of
    // something that isn't a question, like an answer key ("close"). A continuation part, and the unlabelled lines at
    // the top of a group, take this — so the rest of an answer section on the next page never gets joined onto the
    // last question. Page headers and footers don't change it.
    let carryOn: "continue" | "close" = "close";

    groups.forEach((group, g) => {
        const { parts, answerKey: entries } = replies[g]!;
        for (const e of entries) {
            const number = digitsOnly(e.number);
            if (number && e.answer.trim()) answerKey.push({ number, answer: e.answer.trim(), section: e.section?.trim() || null });
        }

        const lineCounts = new Map(group.map((p) => [p.page, orderedLines(p).length]));
        const label = (page: number, line: number, role: LineRole) => roles.set(`${page}.${line - 1}`, role);

        // Lines before the group's first part carry on whatever the previous group ended with.
        const first = parts[0];
        for (const page of group) {
            if (first && page.page > first.page) break;
            const to = first && page.page === first.page ? first.line - 1 : lineCounts.get(page.page)!;
            for (let line = 1; line <= to; line++) label(page.page, line, { kind: carryOn });
        }

        // Each part covers its own start line up to the line before the next part (or the end of the group).
        parts.forEach((part, i) => {
            const nextPart = parts[i + 1];
            let role: LineRole;
            if (part.kind === "question") {
                const excluded = !!part.number && coveredByPassage.has(part.number);
                if (excluded) coveredByPassage.delete(part.number!);
                else questionCount++;
                label(part.page, part.line, { kind: "start", number: part.number, ...(excluded ? { excluded: true } : {}) });
                role = { kind: "continue" };
                carryOn = "continue";
            } else if (part.kind === "continuation") {
                role = { kind: carryOn };
            } else if (part.kind === "header_footer") {
                role = { kind: "transparent" };
            } else {
                role = { kind: "close" };
                carryOn = "close";
            }

            for (const page of group) {
                if (page.page < part.page) continue;
                if (nextPart && page.page > nextPart.page) break;
                const from = page.page === part.page ? part.line + (part.kind === "question" ? 1 : 0) : 1;
                const to = nextPart && page.page === nextPart.page ? nextPart.line - 1 : lineCounts.get(page.page)!;
                for (let line = from; line <= to; line++) label(page.page, line, role);
            }
            if (part.kind === "shared_passage") for (const n of part.covers) coveredByPassage.add(n);
        });
    });

    return { roles, answerKey, questionCount };
}
