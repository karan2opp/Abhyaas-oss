import "dotenv/config";
import { and, eq, isNull } from "drizzle-orm";
import db from "../common/db/index.js";
import { questionBankDocuments } from "../common/db/schema.js";
import { getChunksByDocument, setDocumentTopicTree } from "../module/question_bank/question_bank.service.js";
import { buildTopicTree, mainSubject } from "../module/question_bank/question_bank_topic_tree.js";
import { runAsAiUser } from "../common/agent/ai_context.js";

/**
 * Builds the broad-topic tree for papers processed before trees existed. One small model call per paper: it reads
 * only the subtopic names already saved on the paper's questions, never the questions themselves, and nothing is
 * re-extracted or re-classified. Until a paper has a tree, the picker shows its subtopics as one flat list.
 *
 * Run with:  npx tsx src/scripts/build-question-bank-topic-trees.ts
 * Add --dry-run to list the papers that would be grouped without calling the model.
 */
async function main() {
    const dryRun = process.argv.includes("--dry-run");

    const documents = await db
        .select({ id: questionBankDocuments.id, title: questionBankDocuments.title, createdBy: questionBankDocuments.createdBy })
        .from(questionBankDocuments)
        .where(and(eq(questionBankDocuments.status, "completed"), isNull(questionBankDocuments.topicTree)));

    console.log(`${documents.length} paper(s) without a topic tree`);

    for (const document of documents) {
        if (dryRun) {
            console.log(`  would group: ${document.title} (${document.id})`);
            continue;
        }
        const chunks = await getChunksByDocument(document.id);
        // Billed to the teacher who uploaded the paper, with their own key, like processing it was.
        const tree = await runAsAiUser(document.createdBy, () =>
            buildTopicTree(
                chunks.map((c) => c.topics),
                mainSubject(chunks.map((c) => c.subject))
            )
        );
        await setDocumentTopicTree(document.id, tree);
        console.log(`  ${document.title}: ${tree.broadTopics.length} broad topic(s)`);
    }

    process.exit(0);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
