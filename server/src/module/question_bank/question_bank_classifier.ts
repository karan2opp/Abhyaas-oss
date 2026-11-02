import { z } from "zod";
import { zodResponseFormat } from "openai/helpers/zod";
import { getClientForModel } from "../../common/agent/openai.client.js";
import { env } from "../../env.js";
import type { QuestionBankRawChunk } from "./question_bank_chunker.js";
import type { QuestionBankOption } from "./question_bank.schema.js";
import { getQuestionBankClassifierSystemPrompt } from "../../prompts/question_bank_classifier.prompt.js";

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
    correctOption: z.string().nullable().describe('The answer label if the paper prints one (e.g. "Answer: C" -> "C"). null if the paper does not state the answer — never guess it.'),
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
    correctOption: string | null;
}

// Whitespace differs constantly between the PDF extraction and anything the
// model echoes back (line breaks become spaces, runs of spaces collapse), so
// verbatim checks compare on a whitespace- and case-normalized form.
const normalize = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

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
function verifyOptionSplit(
    original: string,
    stem: string,
    options: { label: string; text: string }[],
    correctOption: string | null
): { questionText: string; options: QuestionBankOption[]; correctOption: string | null } | null {
    if (options.length === 0) return null;

    const haystack = normalize(original);

    for (const option of options) {
        if (!option.text.trim()) return null;
        if (!haystack.includes(normalize(option.text))) return null;
    }

    // Labels have to be distinct, or they can't be referenced unambiguously.
    const labels = options.map((o) => o.label.trim());
    if (labels.some((l) => !l) || new Set(labels).size !== labels.length) return null;

    const trimmedStem = stem.trim();
    if (!trimmedStem || !haystack.includes(normalize(trimmedStem))) return null;

    // An answer key pointing at an option that doesn't exist is a misread —
    // drop the key rather than store a dangling reference.
    const answer = correctOption?.trim() || null;
    const verifiedAnswer = answer && labels.includes(answer) ? answer : null;

    return {
        questionText: trimmedStem,
        options: options.map((o) => ({ label: o.label.trim(), text: o.text.trim() })),
        correctOption: verifiedAnswer,
    };
}

// How many questions go into one classification call. Batching keeps cost
// down without making any one call so large the model starts dropping items.
const CLASSIFY_BATCH_SIZE = 8;

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
export async function classifyQuestionBankChunks(chunks: QuestionBankRawChunk[]): Promise<ChunkClassification[]> {
    if (chunks.length === 0) return [];

    const client = await getClientForModel(env.GENERATION_MODEL);
    const results: (ChunkClassification | undefined)[] = new Array(chunks.length);

    const indexed = chunks.map((chunk, index) => ({ chunk, index }));

    for (const batch of chunkArray(indexed, CLASSIFY_BATCH_SIZE)) {
        const payload = batch.map(({ chunk, index }) => ({
            index,
            questionNumber: chunk.questionNumber,
            text: chunk.rawText,
            tables: chunk.tables.map((t) => ({ header: t.header, rows: t.rows })),
            hasImages: chunk.images.length > 0,
        }));

        const response = await client.chat.completions.create({
            model: env.GENERATION_MODEL,
            messages: [
                { role: "system", content: getQuestionBankClassifierSystemPrompt() },
                { role: "user", content: JSON.stringify({ questions: payload }) },
            ],
            response_format: zodResponseFormat(ClassificationBatchZodSchema, "question_bank_classification"),
        });

        const content = response.choices[0]?.message.content || "{}";
        const parsed = ClassificationBatchZodSchema.parse(JSON.parse(content));

        for (const item of parsed.classifications) {
            if (item.index >= 0 && item.index < results.length) {
                // Enforced in code, not just prompt: unless the model explicitly
                // flags a defect, the original text is used verbatim — whatever
                // it put in cleanedText is discarded. This is what actually
                // prevents rewriting, independent of how well the model follows
                // the prompt on any given call.
                const original = chunks[item.index]?.rawText ?? "";
                const cleanedText = item.needsCleanup ? item.cleanedText : original;

                // Verified against the ORIGINAL text, not cleanedText — the
                // model was shown the original, so that's what its option
                // strings have to match.
                const split = verifyOptionSplit(original, item.questionStem, item.options, item.correctOption);
                if (!split && item.options.length > 0) {
                    console.warn(`[question-bank] rejected unverifiable option split for chunk ${item.index} — storing question unsplit`);
                }

                results[item.index] = {
                    subject: item.subject,
                    topics: item.topics,
                    description: item.description,
                    cleanedText,
                    questionText: split?.questionText ?? cleanedText,
                    options: split?.options ?? [],
                    correctOption: split?.correctOption ?? null,
                };
            }
        }
    }

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
    });
}
