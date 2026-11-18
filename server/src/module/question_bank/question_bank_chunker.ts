import type { ExtractPdfResult, ExtractedImage, ExtractedTable } from "../../common/pdf/pdf_python_bridge.js";

export interface QuestionBankRawChunk {
    questionNumber: string | null;
    rawText: string;
    pageStart: number;
    pageEnd: number;
    images: ExtractedImage[];
    tables: ExtractedTable[];
}

// Matches a line that OPENS a new question: "Q1.", "Q.No.5", "Que 1)",
// "Question No. 12 -", etc. Deliberately requires a Q/Que/Question prefix —
// that's what tells it apart from a bare numbered MCQ option like "1. Paris",
// which never gets this prefix. Used to cut the paper when the splitter (question_bank_splitter.ts) couldn't run, and
// by the splitter to catch a reply that missed a question.
export const QUESTION_MARKER_RE = /^\s*q(?:ue(?:stion)?)?\.?\s*(?:no\.?)?\s*[:\-]?\s*(\d{1,3})\s*[.):\-]?\s*/i;

// The number printed at the start of a question's first line, in any common form: "Q12.", "Que 12)", "12.", "12)",
// "(12)". Removed from the text, since the number is stored separately.
const LEADING_NUMBER_RE = /^\s*(?:q(?:ue(?:stion)?)?\.?\s*(?:no\.?)?\s*[:\-]?\s*(\d{1,3})\s*[.):\-]?|\(?(\d{1,3})\s*[.):\]])\s*/i;

/**
 * What a line is, for cutting the paper into questions:
 *   start       — the first line of a new question. `excluded`: the question depends on a shared passage or figure
 *                 that isn't kept, so it is cut out like any other question but then left out
 *   continue    — more of the current question (also: a question carrying on after a page break)
 *   transparent — not part of any question, but doesn't end one either (a running page header or footer between two
 *                 halves of a question)
 *   close       — not part of any question, and the current question has ended (a section heading, instructions, an
 *                 answer key). Figures after it don't belong to the question above.
 */
export type LineRole =
    | { kind: "start"; number: string | null; excluded?: boolean }
    | { kind: "continue" }
    | { kind: "transparent" }
    | { kind: "close" };

type ExtractedPage = ExtractPdfResult["pages"][number];

/**
 * A page's lines in reading order (top to bottom). Line numbers given to the splitter are positions in THIS order, so
 * the splitter and the cutting below always agree on which line is which.
 */
export function orderedLines(page: ExtractedPage): ExtractedPage["lines"] {
    return page.lines
        .map((line, i) => ({ line, i }))
        .sort((a, b) => (a.line.bbox[1] ?? 0) - (b.line.bbox[1] ?? 0) || a.i - b.i)
        .map(({ line }) => line);
}

// An MCQ option's label at the start of a line: "(A)", "b.", "iii)", "2)". Such a line is an option even when its
// text is code, so it is never pulled into a code block.
const OPTION_LABEL_RE = /^\s*\(?(?:[A-Ha-h]|[ivx]{1,4}|[1-8])[.)]\s/;

/**
 * Which lines are program code: printed in a fixed-width font, when the paper's own text isn't. Keyed by page, as
 * positions in orderedLines. A paper set entirely in a fixed-width font has no code lines this way, since its
 * questions would all look like code.
 */
export function findCodeLines(extracted: ExtractPdfResult): Map<number, Set<number>> {
    const code = new Map<number, Set<number>>();
    const all = extracted.pages.flatMap((page) => page.lines);
    if (!all.some((line) => line.mono)) return code;
    const markers = all.filter((line) => QUESTION_MARKER_RE.test(line.text));
    const sample = markers.length > 0 ? markers : all;
    if (sample.filter((line) => line.mono).length * 2 > sample.length) return code;

    for (const page of extracted.pages) {
        const lines = new Set<number>();
        orderedLines(page).forEach((line, i) => {
            if (line.mono && !OPTION_LABEL_RE.test(line.text)) lines.add(i);
        });
        if (lines.size > 0) code.set(page.page, lines);
    }
    return code;
}

// An answer-key cell: "Q1. C", "12 (b)", "3-d".
const KEY_CELL_RE = /^\s*(?:q(?:ue(?:stion)?)?\.?\s*)?\d{1,3}\s*[.):-]?\s*\(?[A-Ea-e]\)?\s*$/i;

/**
 * Whether a table the PDF reader found belongs to a question's content. Two kinds of grid don't:
 *   - a question's options drawn in boxes ("(A) 24 | (B) 12"): read as text, like any other options
 *   - an answer key laid out as a table ("Q1. C | Q2. B", or numbers in one column and letters in the next)
 */
export function isQuestionTable(table: { rows: (string | null)[][] }): boolean {
    const cells = table.rows.flat().map((cell) => (cell ?? "").trim()).filter(Boolean);
    if (cells.filter((cell) => /^\(?[A-Ha-h][.)]/.test(cell)).length >= 2) return false;
    if (cells.length > 0 && cells.filter((cell) => KEY_CELL_RE.test(cell)).length * 2 >= cells.length) return false;
    const numbers = cells.filter((cell) => /^\d{1,3}$/.test(cell)).length;
    const letters = cells.filter((cell) => /^[A-Ea-e]$/.test(cell)).length;
    return !(numbers >= 2 && letters >= 2 && numbers + letters === cells.length);
}

const insideTable = (tables: ExtractedTable[], bbox: number[]) => {
    const x = ((bbox[0] ?? 0) + (bbox[2] ?? 0)) / 2;
    const y = ((bbox[1] ?? 0) + (bbox[3] ?? 0)) / 2;
    return tables.some((t) => x >= (t.bbox[0] ?? 0) - 1 && x <= (t.bbox[2] ?? 0) + 1 && y >= (t.bbox[1] ?? 0) - 1 && y <= (t.bbox[3] ?? 0) + 1);
};

// One line of a question as cut from the page, with where it sat, so layOut can rebuild code and list indentation.
interface TextLine {
    text: string;
    x: number;
    width: number;
    code: boolean;
}

// A list item's marker: "•", "-", "1.", "a)", "(iv)".
const LIST_MARKER_RE = /^\s*(?:[•▪◦‣*-]|\(?(?:\d{1,2}|[a-zA-Z]|[ivxIVX]{1,4})[.)])\s+/;
// Further right than this (in PDF points) is a second column of options, not a deeper list level.
const MAX_LIST_INDENT = 80;
// Non-breaking spaces survive markdown, which strips ordinary leading spaces, so nested items stay indented on screen.
const LIST_INDENT = " ".repeat(4);

/** How deep each indented list item sits (1 = one step in), by its position on the page. */
function listLevels(lines: TextLine[]): Map<number, number> {
    const items = lines.map((line, i) => ({ line, i })).filter(({ line, i }) => i > 0 && !line.code && LIST_MARKER_RE.test(line.text));
    const levels = new Map<number, number>();
    if (items.length < 2) return levels;
    const left = Math.min(...items.map(({ line }) => line.x));
    const steps: number[] = [];
    for (const { line } of items) {
        const offset = line.x - left;
        if (offset > 2 && offset <= MAX_LIST_INDENT && !steps.some((s) => Math.abs(s - offset) <= 3)) steps.push(offset);
    }
    steps.sort((a, b) => a - b);
    for (const { line, i } of items) {
        const step = steps.findIndex((s) => Math.abs(s - (line.x - left)) <= 3);
        if (step >= 0) levels.set(i, step + 1);
    }
    return levels;
}

/** Code lines with their indentation rebuilt from where each starts on the page, for PDFs that position rather than space it. */
function codeBlock(lines: TextLine[]): string[] {
    const widths = lines.filter((l) => l.text.length > 0 && l.width > 0).map((l) => l.width / l.text.length).sort((a, b) => a - b);
    const charWidth = widths[Math.floor(widths.length / 2)] ?? 0;
    const left = Math.min(...lines.map((l) => l.x));
    return lines.map((l) => " ".repeat(charWidth > 0 ? Math.max(0, Math.round((l.x - left) / charWidth)) : 0) + l.text.trimEnd());
}

/**
 * A question's text: lines joined in order, each run of code lines as a fenced (```) code block, and indented list
 * items indented with a line break before them, so nesting reads the same as on paper.
 */
function layOut(lines: TextLine[]): string {
    const levels = listLevels(lines);
    const out: string[] = [];
    for (let i = 0; i < lines.length; ) {
        if (lines[i]!.code) {
            let j = i;
            while (j < lines.length && lines[j]!.code) j++;
            out.push("```", ...codeBlock(lines.slice(i, j)), "```");
            i = j;
            continue;
        }
        const level = levels.get(i);
        // A line break before and after each indented item ("  " at the end of a line, in markdown).
        if ((level || levels.has(i - 1)) && out.length > 0 && out.at(-1) !== "```") out[out.length - 1] += "  ";
        out.push(level ? LIST_INDENT.repeat(level) + lines[i]!.text.trimStart() : lines[i]!.text);
        i++;
    }
    return out.join("\n");
}

interface PositionedEvent {
    y: number;
    order: number;
    kind: "line" | "image" | "table";
    lineIndex?: number;
    text?: string;
    image?: ExtractedImage;
    table?: ExtractedTable;
}

interface ChunkDraft {
    questionNumber: string | null;
    excluded: boolean;
    textLines: TextLine[];
    pageStart: number;
    pageEnd: number;
    images: ExtractedImage[];
    tables: ExtractedTable[];
}

function finalizeChunk(draft: ChunkDraft): QuestionBankRawChunk | null {
    if (draft.excluded) return null;
    const rawText = layOut(draft.textLines).trim();
    if (!rawText) return null;
    return {
        questionNumber: draft.questionNumber,
        rawText,
        pageStart: draft.pageStart,
        pageEnd: draft.pageEnd,
        images: draft.images,
        tables: draft.tables,
    };
}

/**
 * Walks the whole extracted PDF in true reading order (line, image and table events interleaved by vertical position
 * on each page, using PyMuPDF's bounding boxes) and cuts it into one chunk per question. `roleOf` decides what each
 * line is. An image or table goes to the question being read when it appears, which is what attributes a figure to
 * the SPECIFIC question it sits under, even when several questions share a page.
 *
 * Content before the first question start (titles, instructions) is dropped — there is no question to attach it to.
 * Lines inside a table are left out of the text, since the table itself goes with the question.
 */
function cutIntoChunks(
    extracted: ExtractPdfResult,
    roleOf: (page: number, lineIndex: number, text: string) => LineRole,
    codeLines: Map<number, Set<number>>
): QuestionBankRawChunk[] {
    const chunks: QuestionBankRawChunk[] = [];
    let current: ChunkDraft | null = null;
    // false after a "close" line: the current question has ended, so figures that follow aren't attached to it. A
    // later "continue" line (a question carrying on after a heading the splitter mislabelled) opens it again.
    let accepting = false;

    for (const page of extracted.pages) {
        const lines = orderedLines(page);
        const tables = page.tables.filter(isQuestionTable);
        const pageCode = codeLines.get(page.page);
        const textLine = (i: number, text: string): TextLine => {
            const bbox = lines[i]!.bbox;
            return { text, x: bbox[0] ?? 0, width: (bbox[2] ?? 0) - (bbox[0] ?? 0), code: !!pageCode?.has(i) };
        };
        const events: PositionedEvent[] = [
            ...lines.map((line, i): PositionedEvent => ({ y: line.bbox[1] ?? 0, order: i, kind: "line", lineIndex: i, text: line.text })),
            ...page.images.map((image, i): PositionedEvent => ({ y: image.bbox?.[1] ?? -1, order: 100_000 + i, kind: "image", image })),
            ...tables.map((table, i): PositionedEvent => ({ y: table.bbox[1] ?? -1, order: 200_000 + i, kind: "table", table })),
        ];
        events.sort((a, b) => a.y - b.y || a.order - b.order);

        for (const event of events) {
            if (event.kind === "line") {
                const text = event.text!;
                const role = roleOf(page.page, event.lineIndex!, text);
                if (role.kind === "start") {
                    const finalized = current && finalizeChunk(current);
                    if (finalized) chunks.push(finalized);

                    const marker = text.match(LEADING_NUMBER_RE);
                    const markerNumber = marker ? marker[1] ?? marker[2] : undefined;
                    const number = role.number ?? markerNumber ?? null;
                    // Only strip the printed number when it is this question's number, so a question that happens to
                    // open with a figure ("12 apples are...") keeps its text.
                    const remainder = (marker && markerNumber === number ? text.slice(marker[0].length) : text).trim();
                    current = {
                        questionNumber: number,
                        excluded: !!role.excluded,
                        textLines: remainder ? [{ ...textLine(event.lineIndex!, remainder), code: false }] : [],
                        pageStart: page.page,
                        pageEnd: page.page,
                        images: [],
                        tables: [],
                    };
                    accepting = true;
                } else if (role.kind === "continue") {
                    if (current && !insideTable(tables, lines[event.lineIndex!]!.bbox)) {
                        current.textLines.push(textLine(event.lineIndex!, text));
                        current.pageEnd = page.page;
                        accepting = true;
                    }
                } else if (role.kind === "close") {
                    accepting = false;
                }
                // "transparent": skipped, and the current question carries on.
            } else if (current && accepting) {
                if (event.kind === "image") current.images.push(event.image!);
                else current.tables.push(event.table!);
            }
        }
    }

    const finalized = current && finalizeChunk(current);
    if (finalized) chunks.push(finalized);

    return chunks;
}

/**
 * The fallback split: a new question starts at every line that begins with a Q/Que/Question marker. Used when the
 * splitter couldn't run for a paper. A code line such as "q1 = 5" never starts one.
 */
export function chunkQuestionBankDocument(extracted: ExtractPdfResult): QuestionBankRawChunk[] {
    const codeLines = findCodeLines(extracted);
    return cutIntoChunks(
        extracted,
        (page, line, text) => {
            const match = codeLines.get(page)?.has(line) ? null : text.match(QUESTION_MARKER_RE);
            return match ? { kind: "start", number: match[1] ?? null } : { kind: "continue" };
        },
        codeLines
    );
}

/**
 * The normal split: what each line is comes from the splitter's plan, keyed "page.line" (see orderedLines). A line
 * the plan doesn't mention carries on whatever came before it.
 */
export function chunkByPlan(extracted: ExtractPdfResult, roles: Map<string, LineRole>): QuestionBankRawChunk[] {
    return cutIntoChunks(extracted, (page, line) => roles.get(`${page}.${line}`) ?? { kind: "continue" }, findCodeLines(extracted));
}
