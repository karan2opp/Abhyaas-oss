import { z } from "zod";
import { zodResponseFormat } from "openai/helpers/zod";
import { getClientForModel } from "../../common/agent/openai.client.js";
import { env } from "../../env.js";
import { withAiRetry } from "../../common/agent/ai_retry.js";
import pLimit from "p-limit";
import type { QuestionBankRawChunk } from "./question_bank_chunker.js";
import type { QuestionBankOption } from "./question_bank.schema.js";
import { getQuestionBankClassifierSystemPrompt } from "../../prompts/question_bank_classifier.prompt.js";
import { subtopicsOf } from "./question_bank_topic_tree.js";

const ParsedOptionZodSchema = z.object({
    label: z.string().describe('The option marker exactly as printed, without brackets or punctuation — "A", "b", "iii", "2".'),
    text: z.string().describe("The option's text copied VERBATIM from the question, with the label marker removed and nothing else changed."),
});

const ClassifiedChunkZodSchema = z.object({
    index: z.number(),
    subject: z.string(),
    topics: z.array(z.string()).min(1),
    description: z.string(),
    needsCleanup: z.boolean().describe("true ONLY if the original text has a genuine mechanical defect. false in every other case, including text that is merely awkward, terse, or informally worded."),
    cleanedText: z.string().describe("Ignored by the caller unless needsCleanup is true — see needsCleanup."),
    questionStem: z.string().describe("The question itself with the option lines and any answer line removed. Copied verbatim — never reworded."),
    options: z.array(ParsedOptionZodSchema).describe("The multiple-choice options, in the order printed. Empty array if this is not a multiple-choice question."),
    correctOption: z.string().nullable().describe("The label of the correct option: printed with the question, or worked out when no answer is known (see answerFrom). null otherwise."),
    answerFrom: z.enum(["printed", "solved", "none"]).describe('"printed": the paper prints the answer with this question. "solved": no answer was known, so it was worked out. "none": no correctOption given.'),
});

const ClassificationBatchZodSchema = z.object({
    classifications: z.array(ClassifiedChunkZodSchema),
});

export interface ChunkClassification {
    subject: string;
    topics: string[];
    description: string;
    // The question's text after a mechanical cleanup pass (see question_bank_classifier.prompt.ts)
    // — never a rewrite. This is what gets stored/returned as the question,
    // replacing the raw chunker output.
    cleanedText: string;
    // The stem with option/answer lines lifted out. Falls back to cleanedText
    // whenever the split couldn't be verified (see verifyOptionSplit).
    questionText: string;
    options: QuestionBankOption[];
    // The answer printed with the question itself ("Answer: C"), checked against the options.
    correctOption: string | null;
    // The answer the model worked out because none was known, checked against the options. Only used when the paper
    // gives no answer at all.
    solvedOption: string | null;
}

// Whitespace differs constantly between the PDF extraction and anything the
// model echoes back (line breaks become spaces, runs of spaces collapse, code
// fences get dropped), so verbatim checks compare on a form that ignores
// whitespace, ``` fences and case. `at[k]` is where the k-th character of
// `flat` came from in the original, so a match can be cut out of the original.
function flatten(s: string): { flat: string; at: number[] } {
    let flat = "";
    const at: number[] = [];
    let gap = -1;
    for (let i = 0; i < s.length; ) {
        const fence = s.startsWith("```", i);
        if (fence || /\s/.test(s[i]!)) {
            if (gap < 0) gap = i;
            i += fence ? 3 : 1;
            continue;
        }
        if (gap >= 0 && flat.length > 0) {
            flat += " ";
            at.push(gap);
        }
        gap = -1;
        for (const c of s[i]!.toLowerCase()) {
            flat += c;
            at.push(i);
        }
        i++;
    }
    return { flat, at };
}

/**
 * Finds `fragment` in `original` the way verbatim checks compare text, and returns that stretch of the ORIGINAL — so
 * what gets stored keeps the paper's own code indentation and list layout even when the model flattened its copy.
 * null when it isn't there. `keepCodeWhole`: a stretch starting or ending inside a code block is widened to its fences.
 */
function locate(original: string, fragment: string, keepCodeWhole = false): string | null {
    const source = flatten(original);
    const wanted = flatten(fragment).flat;
    const k = wanted ? source.flat.indexOf(wanted) : -1;
    if (k < 0) return null;
    let start = source.at[k]!;
    let end = source.at[k + wanted.length - 1]! + 1;
    if (keepCodeWhole) {
        const fencesBefore = (p: number) => (original.slice(0, p).match(/```/g) ?? []).length;
        if (fencesBefore(start) % 2 === 1) start = original.lastIndexOf("```", start);
        if (fencesBefore(end) % 2 === 1) {
            const close = original.indexOf("```", end);
            end = close < 0 ? original.length : close + 3;
        }
    }
    return original.slice(start, end).trim();
}

// Code blocks and indented list items, laid out by the chunker (question_bank_chunker.ts layOut).
const hasLayout = (text: string) => text.includes("```") || text.includes(" ");

/**
 * Gate on the model's option split: every option's text must actually appear
 * in the question as extracted, and the stem must too. If any part fails, the
 * whole split is rejected and the chunk keeps its unsplit text.
 *
 * This is the same principle as the cleanedText guard — the model is trusted
 * to LOCATE structure, never to author it. An invented or reworded option
 * can't survive this check, no matter what the prompt did or didn't get
 * across on a given call.
 */
export function verifyOptionSplit(
    original: string,
    stem: string,
    options: { label: string; text: string }[],
    correctOption: string | null
): { questionText: string; options: QuestionBankOption[]; correctOption: string | null } | null {
    if (options.length === 0) return null;

    const optionTexts: string[] = [];
    for (const option of options) {
        const text = option.text.trim() ? locate(original, option.text) : null;
        if (!text) return null;
        optionTexts.push(text);
    }

    // Labels have to be distinct, or they can't be referenced unambiguously.
    const labels = options.map((o) => o.label.trim());
    if (labels.some((l) => !l) || new Set(labels).size !== labels.length) return null;

    const questionText = stem.trim() ? locate(original, stem, true) : null;
    if (!questionText) return null;

    // An answer key pointing at an option that doesn't exist is a misread —
    // drop the key rather than store a dangling reference.
    const answer = correctOption?.trim() || null;
    const verifiedAnswer = answer && labels.includes(answer) ? answer : null;

    return {
        questionText,
        options: options.map((o, i) => ({ label: o.label.trim(), text: optionTexts[i]! })),
        correctOption: verifiedAnswer,
    };
}

// How many questions go into one classification call. Batching keeps cost
// down without making any one call so large the model starts dropping items.
const CLASSIFY_BATCH_SIZE = 8;
// Batches with the model at once, and how long one batch may take (it may be working out answers).
const CLASSIFY_CONCURRENCY = 3;
const CLASSIFY_TIMEOUT_MS = 180_000;

function chunkArray<T>(items: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
    return out;
}

/**
 * Classifies subject/topics/description AND does a mechanical cleanup pass
 * (spacing/spelling/stray-text-removal — never a rewrite) for a batch of
 * extracted question chunks, in one call per batch. This is the one LLM pass
 * in the pipeline that "understands" the question — everything else
 * (chunking, image/table attribution) is pure extraction. `description` is
 * deliberately the field embedded for search (see question_bank.service.ts)
 * rather than the question text, since the text alone is often too thin to
 * search well (e.g. "Find x in the figure below").
 */
export async function classifyQuestionBankChunks(
    chunks: QuestionBankRawChunk[],
    // Per chunk: whether the paper's answer key already gives this question's answer, so the model doesn't spend time
    // working it out.
    answerKnown?: boolean[],
    // Called as each batch comes back with how many questions are done so far, for the progress bar.
    onProgress?: (done: number, total: number) => void
): Promise<ChunkClassification[]> {
    if (chunks.length === 0) return [];

    const client = await getClientForModel(env.GENERATION_MODEL, "question_bank_classify");
    const results: (ChunkClassification | undefined)[] = new Array(chunks.length);

    const indexed = chunks.map((chunk, index) => ({ chunk, index }));
    const limit = pLimit(CLASSIFY_CONCURRENCY);
    let done = 0;

    await Promise.all(
        chunkArray(indexed, CLASSIFY_BATCH_SIZE).map((batch) =>
            limit(async () => {
                const payload = batch.map(({ chunk, index }) => ({
                    index,
                    questionNumber: chunk.questionNumber,
                    text: chunk.rawText,
                    tables: chunk.tables.map((t) => ({ header: t.header, rows: t.rows })),
                    hasImages: chunk.images.length > 0,
                    answerKnown: answerKnown?.[index] ?? false,
                }));

                const parsed = await withAiRetry(`classify questions ${batch[0]!.index + 1}-${batch.at(-1)!.index + 1}`, async () => {
                    const response = await client.chat.completions.create(
                        {
                            model: env.GENERATION_MODEL,
                            messages: [
                                { role: "system", content: getQuestionBankClassifierSystemPrompt() },
                                { role: "user", content: JSON.stringify({ questions: payload }) },
                            ],
                            response_format: zodResponseFormat(ClassificationBatchZodSchema, "question_bank_classification"),
                        },
                        { maxRetries: 0, timeout: CLASSIFY_TIMEOUT_MS }
                    );
                    return ClassificationBatchZodSchema.parse(JSON.parse(response.choices[0]?.message.content || "{}"));
                });

                for (const item of parsed.classifications) {
                    if (item.index >= 0 && item.index < results.length) {
                        // Enforced in code, not just prompt: unless the model explicitly
                        // flags a defect, the original text is used verbatim — whatever
                        // it put in cleanedText is discarded. This is what actually
                        // prevents rewriting, independent of how well the model follows
                        // the prompt on any given call.
                        const original = chunks[item.index]?.rawText ?? "";
                        // A question with code or an indented list keeps its own text: a cleanup pass could flatten
                        // the indentation that matters there.
                        const cleanedText = item.needsCleanup && !hasLayout(original) ? item.cleanedText : original;

                        // Verified against the ORIGINAL text, not cleanedText — the
                        // model was shown the original, so that's what its option
                        // strings have to match.
                        const split = verifyOptionSplit(original, item.questionStem, item.options, item.correctOption);
                        if (!split && item.options.length > 0) {
                            console.warn(`[question-bank] rejected unverifiable option split for chunk ${item.index} — storing question unsplit`);
                        }

                        results[item.index] = {
                            subject: item.subject,
                            topics: subtopicsOf(item.topics),
                            description: item.description,
                            cleanedText,
                            questionText: split?.questionText ?? cleanedText,
                            options: split?.options ?? [],
                            correctOption: item.answerFrom === "printed" ? (split?.correctOption ?? null) : null,
                            solvedOption: item.answerFrom === "solved" ? (split?.correctOption ?? null) : null,
                        };
                    }
                }
                done += batch.length;
                onProgress?.(done, chunks.length);
            })
        )
    );

    // Fallback for any chunk the model dropped, so one bad batch never fails
    // the whole document — it just keeps its original extracted text as-is
    // (never blank it out) with a thin, text-only classification.
    return results.map((result, i) => result ?? {
        subject: "Unclassified",
        topics: [],
        description: (chunks[i]?.rawText ?? "").slice(0, 200),
        cleanedText: chunks[i]?.rawText ?? "",
        questionText: chunks[i]?.rawText ?? "",
        options: [],
        correctOption: null,
        solvedOption: null,
    });
}
