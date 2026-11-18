import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pLimit from "p-limit";
import { inngest } from "../../../common/inngest/client.js";
import { bindAiUser, runAsAiUser } from "../../../common/agent/ai_context.js";
import { withUsageSteps } from "../../../common/agent/usage_context.js";
import { toAiKeyApiError } from "../../ai_keys/ai_key.service.js";
import { extractPdf } from "../../../common/pdf/pdf_python_bridge.js";
import { uploadToCloudinary } from "../../../common/config/cloudinary.js";
import { chunkByPlan, chunkQuestionBankDocument, type QuestionBankRawChunk } from "../question_bank_chunker.js";
import { classifyQuestionBankChunks } from "../question_bank_classifier.js";
import { matchKeyToQuestions, parseAnswerKey, resolveAnswerLabel, splitIntoBlocks, stripAnswerKeyContent, type AnswerKeyBlock } from "../question_bank_answer_key.js";
import { splitPaper } from "../question_bank_splitter.js";
import { getDocument, markDocumentProcessing, markDocumentCompleted, markDocumentFailed, saveChunk, embedText, setDocumentProgress, deleteChunksByDocument, setDocumentTopicTree } from "../question_bank.service.js";
import { buildTopicTree, mainSubject } from "../question_bank_topic_tree.js";
import { upsertQuestionBankPoints } from "../qdrant_client.js";
import type { QuestionBankImage, QuestionBankTable, QuestionBankList } from "../question_bank.schema.js";

// How many chunks get their images uploaded / embedded / persisted at once.
const PERSIST_CONCURRENCY = 3;

async function downloadToFile(url: string, destPath: string): Promise<void> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to download PDF (${response.status} ${response.statusText})`);
    const buffer = Buffer.from(await response.arrayBuffer());
    await fs.writeFile(destPath, buffer);
}

/**
 * Full question-bank ingestion pipeline for one uploaded PDF: extract (the
 * shared PyMuPDF subprocess) -> a fast model finds where each question starts
 * and reads the answer key (question_bank_splitter.ts), and code cuts the
 * questions out (bbox-based, see question_bank_chunker.ts) -> classify +
 * mechanically clean each chunk, working out MCQ answers the paper doesn't give
 * -> (after saving) group the paper's subtopics into broad topics
 * (subject/topics/description, and a spacing/spelling/stray-text cleanup
 * pass over the extracted text — never a rewrite, see
 * question_bank_classifier.ts) -> embed the description -> persist the
 * cleaned chunk to Postgres and its vector to Qdrant, using the SAME id for
 * both so a search hit's point id is directly the Postgres row id.
 */
export const processQuestionBankDocumentFunction = inngest.createFunction(
    {
        id: "question-bank-process-document",
        retries: 2,
        triggers: [{ event: "question-bank/document.process" }],
    },
    async ({ event, step }) => {
        const documentId = event.data.documentId as string;
        // Reading and indexing this document uses AI, billed to the teacher who uploaded it, with their own key.
        const owner = (await getDocument(documentId))?.createdBy;
        if (owner) {
            bindAiUser(owner);
            step = withUsageSteps(step, {}, (fn) => runAsAiUser(owner, fn));
        }

        let tmpDir: string | null = null;

        try {
            const document = await step.run("load-document", async () => {
                const doc = await getDocument(documentId);
                if (!doc) throw new Error(`Question bank document ${documentId} not found`);
                await markDocumentProcessing(documentId);
                return doc;
            });

            // The progress bar in the paper list. Never allowed to fail the paper.
            const progress = (percent: number, label: string) => {
                void setDocumentProgress(documentId, percent, label).catch(() => {});
            };

            const { extracted, tmpDir: dir } = await step.run("download-and-extract", async () => {
                progress(2, "Reading the PDF");
                const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "question-bank-"));
                const pdfPath = path.join(workDir, "input.pdf");
                const outputDir = path.join(workDir, "out");
                await downloadToFile(document.fileUrl, pdfPath);
                const result = await extractPdf(pdfPath, outputDir);
                console.log(`[question-bank] extracted ${result.pages.length} page(s) for document ${documentId}`);
                return { extracted: result, tmpDir: workDir };
            });
            tmpDir = dir;

            // Where each question starts and what the answer key says. Its own step, so a later failure doesn't pay
            // for this again. If the splitter can't be used, the paper is cut with the old "Q + number" rule.
            const split = await step.run("split-questions", async () => {
                const started = Date.now();
                const patternKey = parseAnswerKey(extracted);
                try {
                    progress(10, "Finding the questions");
                    const plan = await splitPaper(extracted, documentId, (done, total) => progress(10 + (15 * done) / total, "Finding the questions"));
                    if (plan.questionCount === 0) throw new Error("the splitter found no questions");
                    const rawChunks = chunkByPlan(extracted, plan.roles);
                    const splitterKey = splitIntoBlocks(plan.answerKey);
                    console.log(`[question-bank] split ${documentId} into ${rawChunks.length} question(s) in ${Date.now() - started}ms (answer key: ${plan.answerKey.length} entr(ies))`);
                    return { method: "splitter" as const, rawChunks, keyBlocks: splitterKey.length > 0 ? splitterKey : patternKey };
                } catch (err: any) {
                    console.warn(`[question-bank] splitter unavailable for ${documentId} (${err?.message ?? err}) — using the Q-marker split`);
                    // Strip a recognised key before classifying, so the last question doesn't carry it as its content.
                    const rawChunks: QuestionBankRawChunk[] = chunkQuestionBankDocument(extracted).map(stripAnswerKeyContent);
                    return { method: "fallback" as const, rawChunks, keyBlocks: patternKey as AnswerKeyBlock[] };
                }
            });

            const classifiedChunks = await step.run("classify", async () => {
                const started = Date.now();
                const { rawChunks, keyBlocks } = split;

                const keyed = matchKeyToQuestions(rawChunks.map((chunk) => chunk.questionNumber), keyBlocks);
                if (keyBlocks.length > 0 && !keyed.usable) {
                    console.warn(`[question-bank] answer key for document ${documentId} could not be matched to the questions — leaving it unused`);
                }

                progress(25, `Reading questions 0 of ${rawChunks.length}`);
                const classifications = await classifyQuestionBankChunks(rawChunks, keyed.answers.map((answer) => !!answer), (done, total) =>
                    progress(25 + (45 * done) / total, `Reading questions ${done} of ${total}`)
                );

                let fromAi = 0;
                const result = rawChunks.map((chunk, i) => {
                    const classification = classifications[i]!;
                    const labels = classification.options.map((o) => o.label);
                    // The paper's own answer comes first: its answer key, then an answer printed with the question.
                    // Only when the paper gives none is the answer the model worked out used. Every one of them has to
                    // name a real option of this question.
                    const fromKey = keyed.answers[i] ? resolveAnswerLabel(keyed.answers[i]!, labels) : null;
                    const fromPaper = fromKey ?? classification.correctOption;
                    const correctOption = fromPaper ?? classification.solvedOption;
                    const answerSource = fromPaper ? ("paper" as const) : correctOption ? ("ai" as const) : null;
                    if (answerSource === "ai") fromAi++;
                    return { chunk, classification: { ...classification, correctOption, answerSource } };
                });

                console.log(`[question-bank] classified ${rawChunks.length} question(s) for ${documentId} in ${Date.now() - started}ms (${fromAi} answer(s) worked out by the model)`);
                return result;
            });

            const totalChunks = await step.run("persist-chunks", async () => {
                const started = Date.now();
                // If this step is being retried after failing partway, its earlier saves are still there. Clearing
                // them first means a retry replaces the questions instead of storing a second copy of each.
                await deleteChunksByDocument(documentId);
                const limit = pLimit(PERSIST_CONCURRENCY);
                let savedCount = 0;
                progress(70, `Saving questions 0 of ${classifiedChunks.length}`);

                await Promise.all(
                    classifiedChunks.map(({ chunk, classification }) =>
                        limit(async () => {
                            const images: QuestionBankImage[] = await Promise.all(
                                chunk.images.map(async (img) => {
                                    const fileBuffer = await fs.readFile(img.path);
                                    const uploaded = await uploadToCloudinary(fileBuffer, "question-bank/images");
                                    return { url: uploaded.url, width: img.width, height: img.height, page: chunk.pageStart };
                                })
                            );

                            const tables: QuestionBankTable[] = chunk.tables.map((t) => ({
                                page: chunk.pageStart,
                                header: t.header,
                                rows: t.rows,
                            }));
                            const lists: QuestionBankList[] = [];

                            const vector = await embedText(classification.description || classification.cleanedText.slice(0, 500));

                            const saved = await saveChunk({
                                documentId,
                                questionNumber: chunk.questionNumber,
                                rawText: classification.cleanedText,
                                questionText: classification.questionText,
                                options: classification.options,
                                correctOption: classification.correctOption,
                                answerSource: classification.answerSource,
                                subject: classification.subject,
                                topics: classification.topics,
                                description: classification.description,
                                pageStart: chunk.pageStart,
                                pageEnd: chunk.pageEnd,
                                images,
                                tables,
                                lists,
                            });

                            await upsertQuestionBankPoints([
                                {
                                    id: saved.id,
                                    vector,
                                    payload: {
                                        documentId,
                                        createdBy: document.createdBy,
                                        subject: classification.subject,
                                        topics: classification.topics,
                                        questionNumber: chunk.questionNumber,
                                        // Parsed options are what make it a
                                        // multiple-choice question; without
                                        // them it's a written answer.
                                        questionType: classification.options.length > 0 ? "mcq" : "descriptive",
                                        hasImages: images.length > 0,
                                        hasTables: tables.length > 0,
                                    },
                                },
                            ]);
                            savedCount++;
                            progress(70 + (25 * savedCount) / classifiedChunks.length, `Saving questions ${savedCount} of ${classifiedChunks.length}`);
                        })
                    )
                );

                console.log(`[question-bank] saved ${classifiedChunks.length} question(s) for ${documentId} in ${Date.now() - started}ms`);
                return classifiedChunks.length;
            });

            // One small call that reads only the subtopic names and groups them into broad topics, so the teacher
            // can browse the paper chapter by chapter. Never fails the paper: on any problem it saves a flat list.
            await step.run("group-topics", async () => {
                progress(96, "Grouping the topics");
                const tree = await buildTopicTree(
                    classifiedChunks.map(({ classification }) => classification.topics),
                    mainSubject(classifiedChunks.map(({ classification }) => classification.subject))
                );
                await setDocumentTopicTree(documentId, tree);
                console.log(`[question-bank] grouped topics into ${tree.broadTopics.length} broad topic(s) for document ${documentId}`);
            });

            await step.run("finalize", async () => {
                await markDocumentCompleted(documentId, totalChunks);
                console.log(`[question-bank] document ${documentId} completed with ${totalChunks} chunk(s)`);
            });
        } catch (err: any) {
            const keyProblem = await toAiKeyApiError(err);
            await markDocumentFailed(documentId, keyProblem?.message || err?.message || "Unknown error processing document");
            throw err;
        } finally {
            if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
        }
    }
);

export const questionBankFunctions = [processQuestionBankDocumentFunction];
