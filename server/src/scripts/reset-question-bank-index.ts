import "dotenv/config";
import { eq } from "drizzle-orm";
import pLimit from "p-limit";
import db from "../common/db/index.js";
import { questionBankChunks, questionBankDocuments } from "../common/db/schema.js";
import { embedText } from "../module/question_bank/question_bank.service.js";
import {
    getQdrantClient,
    ensureQuestionBankCollection,
    upsertQuestionBankPoints,
    QUESTION_BANK_COLLECTION,
} from "../module/question_bank/qdrant_client.js";

/**
 * Drops and rebuilds the question-bank vector collection from Postgres.
 *
 * Needed because the point payload gained `createdBy` and `visibility`, which
 * decide who can retrieve a question. Points indexed before that carry
 * neither, so they match no access filter and are invisible — dead weight
 * that still costs storage. Recreating the collection also picks up the two
 * new payload indexes.
 *
 * Rebuilds from the chunks already in Postgres: the PDFs are NOT re-extracted
 * or re-classified, only the descriptions are re-embedded. That means old
 * chunks keep their existing text and will have no parsed options/answer key
 * — only documents uploaded after this change get those. Re-upload a document
 * if you want it re-parsed.
 *
 * Run with:  npx tsx src/scripts/reset-question-bank-index.ts
 */

const EMBED_CONCURRENCY = 5;

async function main() {
    const dropOnly = process.argv.includes("--drop-only");

    const qdrant = getQdrantClient();
    const exists = await qdrant.collectionExists(QUESTION_BANK_COLLECTION);
    if (exists.exists) {
        await qdrant.deleteCollection(QUESTION_BANK_COLLECTION);
        console.log(`Dropped collection "${QUESTION_BANK_COLLECTION}".`);
    } else {
        console.log(`Collection "${QUESTION_BANK_COLLECTION}" did not exist.`);
    }

    // Recreates the collection and its payload indexes.
    await ensureQuestionBankCollection();
    console.log("Recreated collection with payload indexes.");

    if (dropOnly) {
        console.log("--drop-only given; skipping re-index.");
        return;
    }

    const rows = await db
        .select({
            id: questionBankChunks.id,
            documentId: questionBankChunks.documentId,
            questionNumber: questionBankChunks.questionNumber,
            rawText: questionBankChunks.rawText,
            description: questionBankChunks.description,
            subject: questionBankChunks.subject,
            topics: questionBankChunks.topics,
            options: questionBankChunks.options,
            images: questionBankChunks.images,
            tables: questionBankChunks.tables,
            createdBy: questionBankDocuments.createdBy,
        })
        .from(questionBankChunks)
        .innerJoin(questionBankDocuments, eq(questionBankChunks.documentId, questionBankDocuments.id));

    if (rows.length === 0) {
        console.log("No chunks in Postgres — nothing to re-index.");
        return;
    }

    console.log(`Re-embedding and re-indexing ${rows.length} chunk(s)...`);

    const limit = pLimit(EMBED_CONCURRENCY);
    let done = 0;
    let failed = 0;

    await Promise.all(
        rows.map((row) =>
            limit(async () => {
                try {
                    // Same text the pipeline embeds, so search behaves identically.
                    const vector = await embedText(row.description || row.rawText.slice(0, 500));
                    await upsertQuestionBankPoints([
                        {
                            id: row.id,
                            vector,
                            payload: {
                                documentId: row.documentId,
                                createdBy: row.createdBy,
                                subject: row.subject ?? "Unclassified",
                                topics: row.topics ?? [],
                                questionNumber: row.questionNumber,
                                questionType: (row.options ?? []).length > 0 ? "mcq" : "descriptive",
                                hasImages: (row.images ?? []).length > 0,
                                hasTables: (row.tables ?? []).length > 0,
                            },
                        },
                    ]);
                } catch (err: any) {
                    failed++;
                    console.error(`  chunk ${row.id} failed: ${err?.message ?? err}`);
                    return;
                }

                done++;
                if (done % 25 === 0) console.log(`  ${done}/${rows.length}`);
            })
        )
    );

    console.log(`Done. Re-indexed ${done} chunk(s)${failed > 0 ? `, ${failed} failed` : ""}.`);
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error("Reset failed:", err);
        process.exit(1);
    });
