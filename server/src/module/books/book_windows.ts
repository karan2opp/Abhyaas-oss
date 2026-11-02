import { z } from "zod";
import { callStructured, repairRanges } from "./book_ai.js";
import { isExactHeadingSource, type BookBlockType, type BookHeadingSource } from "./book.schema.js";
import { absorbHeadingOnly, leadingHeadingRun, startsHeadingRun } from "./book_headings.js";
import { getBookWindowIndexSystemPrompt } from "../../prompts/book_window_index.prompt.js";

export const PAGES_PER_WINDOW = 10;
// Dense pages can make 10 pages too long for one call; such windows are cut at a page boundary instead.
const MAX_WINDOW_CHARS = 60_000;
const CONTEXT_CHARS = 5_000;
const CONTEXT_BLOCK_CHARS = 700;

export interface IndexBlock {
    seq: number;
    page: number;
    type: BookBlockType;
    text: string;
    fontSize: number | null;
    bold: boolean;
    headingLevelHint: number | null;
    headingSource: BookHeadingSource | null;
}

export interface BookWindow {
    index: number;
    firstSeq: number;
    lastSeq: number;
    pageStart: number;
    pageEnd: number;
}

export interface WindowSubsection {
    startBlock: number;
    endBlock: number;
    name: string;
    nameGenerated: boolean;
    description: string;
    keyConcepts: string[];
}

export interface WindowResult {
    index: number;
    firstSeq: number;
    lastSeq: number;
    headings: { block: number; level: number }[];
    subsections: WindowSubsection[];
    firstContinuesFromPrevious: boolean;
    lastContinuesIntoNext: boolean;
}

/** Splits the book into windows of about 10 pages. A window always holds whole pages, so it never starts mid-paragraph. */
export function planWindows(blocks: { seq: number; page: number; text: string }[]): BookWindow[] {
    const pages: { page: number; firstSeq: number; lastSeq: number; chars: number }[] = [];
    for (const block of blocks) {
        const last = pages[pages.length - 1];
        if (last && last.page === block.page) {
            last.lastSeq = block.seq;
            last.chars += block.text.length;
        } else {
            pages.push({ page: block.page, firstSeq: block.seq, lastSeq: block.seq, chars: block.text.length });
        }
    }

    const windows: BookWindow[] = [];
    let current: typeof pages = [];
    let chars = 0;
    const flush = () => {
        if (current.length === 0) return;
        windows.push({
            index: windows.length,
            firstSeq: current[0]!.firstSeq,
            lastSeq: current[current.length - 1]!.lastSeq,
            pageStart: current[0]!.page,
            pageEnd: current[current.length - 1]!.page,
        });
        current = [];
        chars = 0;
    };
    for (const page of pages) {
        const spansTooManyPages = current.length > 0 && page.page - current[0]!.page >= PAGES_PER_WINDOW;
        if (spansTooManyPages || (current.length > 0 && chars + page.chars > MAX_WINDOW_CHARS)) flush();
        current.push(page);
        chars += page.chars;
    }
    flush();
    return windows;
}

function renderBlock(block: IndexBlock, maxChars?: number): string {
    const text = maxChars && block.text.length > maxChars ? `${block.text.slice(0, maxChars)} …` : block.text;
    const style = block.fontSize ? ` (${Math.round(block.fontSize * 10) / 10}pt${block.bold ? " bold" : ""})` : "";
    switch (block.type) {
        case "heading": {
            const hint = isExactHeadingSource(block.headingSource)
                ? ` [${block.headingSource} level ${block.headingLevelHint}]`
                : block.headingLevelHint ? ` [suggested level ${block.headingLevelHint}]` : "";
            return `#${block.seq} p${block.page} HEADING${hint}${style}: ${text}`;
        }
        case "image":
            return `#${block.seq} p${block.page} IMAGE: ${text || "(no caption)"}`;
        case "table":
            return `#${block.seq} p${block.page} TABLE:\n${text}`;
        case "list":
            return `#${block.seq} p${block.page} LIST:\n${text}`;
        case "code":
            return `#${block.seq} p${block.page} CODE:\n${text}`;
        default:
            return `#${block.seq} p${block.page} PARAGRAPH${style}: ${text}`;
    }
}

function takeChars(blocks: IndexBlock[], budget: number, fromEnd: boolean): IndexBlock[] {
    const ordered = fromEnd ? [...blocks].reverse() : blocks;
    const out: IndexBlock[] = [];
    let used = 0;
    for (const block of ordered) {
        if (used >= budget) break;
        out.push(block);
        used += Math.min(block.text.length, CONTEXT_BLOCK_CHARS);
    }
    return fromEnd ? out.reverse() : out;
}

const WindowOutputZodSchema = z.object({
    headings: z.array(z.object({ block: z.number().int(), level: z.number().int() })),
    subsections: z.array(
        z.object({
            startBlock: z.number().int(),
            endBlock: z.number().int(),
            name: z.string(),
            description: z.string(),
            keyConcepts: z.array(z.string()),
        })
    ),
    firstContinuesFromPrevious: z.boolean(),
    lastContinuesIntoNext: z.boolean(),
});

type WindowOutput = z.infer<typeof WindowOutputZodSchema>;

/**
 * Checks and repairs one window's answer so the merge can rely on it: headings inside the window only,
 * bookmark levels enforced, subsections covering every block exactly once, and a subsection starting at
 * every heading. Heading-started subsections take the heading's exact text as their name.
 */
function normalizeWindowOutput(output: WindowOutput, window: BookWindow, owned: Map<number, IndexBlock>): { result: WindowResult; missingStarts: number } {
    const inWindow = (seq: number) => seq >= window.firstSeq && seq <= window.lastSeq && owned.has(seq);

    const headingLevels = new Map<number, number>();
    for (const h of output.headings) {
        if (inWindow(h.block) && h.level >= 1 && h.level <= 3) headingLevels.set(h.block, h.level);
    }
    for (const block of owned.values()) {
        if (isExactHeadingSource(block.headingSource) && block.headingLevelHint) headingLevels.set(block.seq, block.headingLevelHint);
    }

    let subsections = repairRanges(
        output.subsections.map((s) => ({ ...s, start: s.startBlock, end: s.endBlock })),
        window.firstSeq,
        window.lastSeq
    );
    if (subsections.length === 0) {
        subsections = [{ startBlock: window.firstSeq, endBlock: window.lastSeq, start: window.firstSeq, end: window.lastSeq, name: "", description: "", keyConcepts: [] }];
    }

    // A subsection must start at every heading run; headings directly after another heading stay in that run.
    const starts = new Set(subsections.map((s) => s.start));
    const missing = [...headingLevels.keys()].filter((seq) => startsHeadingRun(seq, headingLevels) && !starts.has(seq)).sort((a, b) => a - b);

    // Split at any heading the model didn't start a subsection on; the new part inherits the description.
    for (const seq of missing) {
        const index = subsections.findIndex((s) => s.start < seq && s.end >= seq);
        if (index === -1) continue;
        const parent = subsections[index]!;
        const tail = { ...parent, start: seq, end: parent.end, keyConcepts: [...parent.keyConcepts] };
        parent.end = seq - 1;
        subsections.splice(index + 1, 0, tail);
    }

    const pages = (start: number, end: number) => {
        const a = owned.get(start)?.page;
        const b = owned.get(end)?.page;
        return a === b ? `page ${a}` : `pages ${a}–${b}`;
    };

    const result: WindowResult = {
        index: window.index,
        firstSeq: window.firstSeq,
        lastSeq: window.lastSeq,
        headings: [...headingLevels.entries()].map(([block, level]) => ({ block, level })).sort((a, b) => a.block - b.block),
        subsections: absorbHeadingOnly(
            subsections.map((s) => ({ ...s, startBlock: s.start, endBlock: s.end })),
            headingLevels
        ).map((s) => {
            const run = leadingHeadingRun(s.startBlock, s.endBlock, headingLevels);
            let heading = run.length > 0 ? owned.get(run[run.length - 1]!)?.text.trim() : undefined;
            // A stretch of title-like lines that aren't structural headings (a title page) is named by its own text.
            const rangeBlocks = [...owned.values()].filter((b) => b.seq >= s.startBlock && b.seq <= s.endBlock);
            const titleLinesOnly = !heading && rangeBlocks.length > 0 && rangeBlocks.length <= 4 && rangeBlocks.every((b) => b.type === "heading");
            if (titleLinesOnly) heading = rangeBlocks.map((b) => b.text.trim()).join(" ");
            return {
                startBlock: s.startBlock,
                endBlock: s.endBlock,
                name: heading || s.name.trim() || `Content, ${pages(s.startBlock, s.endBlock)}`,
                nameGenerated: !heading,
                // Title lines carry no teachable content, so the model's description for them is replaced, not trusted.
                description: titleLinesOnly ? `Title page: ${heading}.` : s.description.trim(),
                keyConcepts: titleLinesOnly ? [] : [...new Set(s.keyConcepts.map((k) => k.trim()).filter(Boolean))].slice(0, 10),
            };
        }),
        firstContinuesFromPrevious: output.firstContinuesFromPrevious && !headingLevels.has(window.firstSeq),
        lastContinuesIntoNext: output.lastContinuesIntoNext,
    };
    return { result, missingStarts: missing.length };
}

/**
 * Indexes one window. `blocks` must include the window's own blocks plus the blocks of the pages
 * around it, which are shown to the model as read-only context.
 */
export async function indexWindow(window: BookWindow, blocks: IndexBlock[]): Promise<WindowResult> {
    const ownedBlocks = blocks.filter((b) => b.seq >= window.firstSeq && b.seq <= window.lastSeq);
    const owned = new Map(ownedBlocks.map((b) => [b.seq, b]));
    const before = takeChars(blocks.filter((b) => b.seq < window.firstSeq), CONTEXT_CHARS, true);
    const after = takeChars(blocks.filter((b) => b.seq > window.lastSeq), CONTEXT_CHARS, false);

    const user = [
        `CONTEXT BEFORE YOUR WINDOW (read only):`,
        before.length ? before.map((b) => renderBlock(b, CONTEXT_BLOCK_CHARS)).join("\n") : "(start of the book)",
        ``,
        `YOUR WINDOW: blocks #${window.firstSeq} to #${window.lastSeq}, pages ${window.pageStart}–${window.pageEnd}`,
        ownedBlocks.map((b) => renderBlock(b)).join("\n"),
        ``,
        `CONTEXT AFTER YOUR WINDOW (read only):`,
        after.length ? after.map((b) => renderBlock(b, CONTEXT_BLOCK_CHARS)).join("\n") : "(end of the book)",
    ].join("\n");

    const first = normalizeWindowOutput(await callStructured(WindowOutputZodSchema, "book_window_index", getBookWindowIndexSystemPrompt(), user), window, owned);
    if (first.missingStarts === 0) return first.result;

    // One retry with feedback when headings were left inside subsections; otherwise the code split stands.
    const feedback = `${user}\n\nIMPORTANT: a previous attempt put headings in the middle of subsections. Every heading you list must be the startBlock of a subsection.`;
    const retry = normalizeWindowOutput(await callStructured(WindowOutputZodSchema, "book_window_index", getBookWindowIndexSystemPrompt(), feedback), window, owned);
    return retry.missingStarts <= first.missingStarts ? retry.result : first.result;
}
