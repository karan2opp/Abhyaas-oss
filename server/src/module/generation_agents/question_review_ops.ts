import type { Requester } from "../../common/permissions/index.js";
import { createQuestion, updateQuestion, deleteQuestion, getQuestionById } from "../questions/question.service.js";
import { generateTopicQuestions } from "./agents/generation_agent.js";
import { assertQuota, recordUsage } from "../plans/quota.service.js";
import { findContentBlocksProblem } from "./table_blocks.util.js";
import { assertMcqAnswersAreCorrect, type McqToVerify } from "./question_review_verification.js";
import type {
    AddQuestionArgs,
    GenerateQuestionsArgs,
    RemoveQuestionArgs,
    UpdateQuestionArgs,
    UpdateQuestionOptionsArgs,
} from "./Types/outputQuestionReview.js";

const OPTION_LETTERS = ["A", "B", "C", "D"] as const;

// Thrown as an ordinary tool error, so the agent sees it and can resend the table fixed.
function assertTablesAddUp(blocks: readonly { type: string }[]) {
    const problem = findContentBlocksProblem(blocks);
    if (problem) throw new Error(`The table's merged cells don't add up: ${problem} Fix the table and call the tool again.`);
}

export interface QuestionReviewResult {
    changeLog: string[];
}

// PostgreSQL's jsonb reorders object keys, so stored content blocks have to be
// compared with keys sorted, or every code block would look "changed".
const canonicalJson = (value: unknown): string =>
    JSON.stringify(value, (_key, v) =>
        v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v
    );

// Where a new question goes. A replacement takes the old question's exact
// section, block, and position, so it stays at the same number on screen.
// Looking the old question up first also means a wrong id fails before
// anything is created, instead of leaving an extra question behind.
async function placementFor(args: { section_id: string; block_id: string | null; replaces_question_id: string | null }, requester: Requester) {
    if (!args.replaces_question_id) {
        return { sectionId: args.section_id, blockId: args.block_id ?? undefined, position: undefined };
    }
    const old = await getQuestionById(args.replaces_question_id, requester);
    return { sectionId: old.sectionId, blockId: old.blockId ?? undefined, position: old.position };
}

// Operates directly on the real, already-saved exam — questions/options
// tables via the same service functions the manual question editor uses.
// There's no separate "generation session" state to keep in sync: every
// mutation here IS the final saved state, immediately.
//
// Every path that can produce or change an MCQ's options runs them through
// assertMcqAnswersAreCorrect before persisting. That call throws (rather
// than returning a pass/fail) if anything is wrong, so it can just be
// awaited inline — a failure surfaces as this whole apply* function
// throwing, which the agent sees as a tool error and can act on in the
// same turn, exactly like the structural checks below it.

export async function applyAddQuestion(args: AddQuestionArgs, requester: Requester): Promise<QuestionReviewResult> {
    assertTablesAddUp(args.content_blocks);
    const placement = await placementFor(args, requester);

    if (args.type === "mcq") {
        if (!args.options || args.options.length !== 4 || !args.correct_option) {
            throw new Error("An MCQ question needs exactly 4 options and a correct_option.");
        }
        await assertMcqAnswersAreCorrect([
            {
                questionText: args.question_text,
                contentBlocks: args.content_blocks,
                options: args.options.map((opt, i) => ({ label: OPTION_LETTERS[i]!, text: opt.text })),
                claimedCorrectOption: args.correct_option,
            },
        ]);
    }

    await createQuestion(
        {
            ...placement,
            type: args.type,
            description: args.question_text,
            marks: args.marks,
            contentBlocks: args.content_blocks,
            options:
                args.type === "mcq"
                    ? args.options!.map((opt, i) => ({ value: opt.text, isCode: opt.isCode, isCorrect: OPTION_LETTERS[i] === args.correct_option }))
                    : undefined,
        } as any,
        requester
    );

    // Only removed once the new question is confirmed created (and, for
    // MCQ, already passed the check above) — a "replace" can never leave
    // the exam with both the old and new version, or with neither.
    if (args.replaces_question_id) {
        await deleteQuestion(args.replaces_question_id, requester);
        return { changeLog: [`Replaced a question with a new ${args.type} question.`] };
    }

    return { changeLog: [`Added a new ${args.type} question.`] };
}

// Delegates to the real generation agent (same one the initial batch used) —
// count is already capped 1-3 by the zod schema, so this can never turn into
// a bulk regeneration no matter what the teacher asks for.
export async function applyGenerateQuestions(args: GenerateQuestionsArgs, requester: Requester): Promise<QuestionReviewResult> {
    if (args.replaces_question_id && args.count !== 1) {
        throw new Error("replaces_question_id only makes sense with count 1 — replacing one question with several has no single target. Generate the replacement alone first, then handle any extra questions as a separate addition.");
    }

    // The agent sees this as an ordinary tool error, so it can tell the teacher their plan has run out.
    await assertQuota(requester.id, "question_generation", args.count);

    const placement = await placementFor(args, requester);
    const output = await generateTopicQuestions({
        subject: args.subject,
        question_type: args.question_type,
        marks: args.marks,
        topic: args.topic,
        subtopics: [{ name: args.subtopic, count: args.count }],
        globalInstructions: args.instructions || [],
        topicInstructions: [],
    });

    // One batched check for every MCQ this call produced, rather than one
    // API call per question — generate_questions alone can return up to 3.
    const mcqChecks: McqToVerify[] = output.questions
        .filter((q) => q.type === "mcq")
        .map((q) => ({
            questionText: q.question_text,
            contentBlocks: q.content_blocks,
            options: q.options.map((opt, i) => ({ label: OPTION_LETTERS[i]!, text: opt.text })),
            claimedCorrectOption: q.correct_option,
        }));
    await assertMcqAnswersAreCorrect(mcqChecks);

    for (const q of output.questions) {
        await createQuestion(
            {
                ...placement,
                type: q.type,
                description: q.question_text,
                marks: args.marks,
                topic: args.topic,
                subtopic: q.subtopic || args.subtopic,
                contentBlocks: q.content_blocks,
                options: q.type === "mcq"
                    ? q.options.map((opt, i) => ({ value: opt.text, isCode: opt.isCode, isCorrect: OPTION_LETTERS[i] === q.correct_option }))
                    : undefined,
            } as any,
            requester
        );
    }

    await recordUsage(requester.id, "question_generation", output.questions.length);

    // Same atomicity guarantee as applyAddQuestion: the old question is only
    // removed after every new one is confirmed created and verified.
    if (args.replaces_question_id) {
        await deleteQuestion(args.replaces_question_id, requester);
        return { changeLog: [`Replaced a question with a new AI-generated question for "${args.topic}" / "${args.subtopic}".`] };
    }

    return { changeLog: [`Generated ${output.questions.length} new question(s) for "${args.topic}" / "${args.subtopic}".`] };
}

export async function applyRemoveQuestion(args: RemoveQuestionArgs, requester: Requester): Promise<QuestionReviewResult> {
    await deleteQuestion(args.question_id, requester);
    return { changeLog: ["Removed a question."] };
}

// Saves the complete edited question in one go: text, content blocks, and
// options (MCQ, fact-checked) always together.
export async function applyUpdateQuestion(args: UpdateQuestionArgs, requester: Requester): Promise<QuestionReviewResult> {
    assertTablesAddUp(args.content_blocks);
    const existing = await getQuestionById(args.question_id, requester);

    if (existing.type === "mcq") {
        if (!args.options || args.options.length !== 4 || !args.correct_option) {
            throw new Error("Updating an MCQ needs all 4 options and correct_option, matching the new text and content.");
        }
        await assertMcqAnswersAreCorrect([
            {
                questionText: args.question_text,
                contentBlocks: args.content_blocks,
                options: args.options.map((opt, i) => ({ label: OPTION_LETTERS[i]!, text: opt.text })),
                claimedCorrectOption: args.correct_option,
            },
        ]);
    }

    // A descriptive question's grading guide is written for the new wording later, so nothing about it is saved here.
    await updateQuestion(
        args.question_id,
        {
            description: args.question_text,
            contentBlocks: args.content_blocks,
            ...(existing.type === "mcq"
                ? { options: args.options!.map((opt, i) => ({ value: opt.text, isCode: opt.isCode, isCorrect: OPTION_LETTERS[i] === args.correct_option })) }
                : {}),
        } as any,
        requester
    );

    // Every update re-sends the content blocks, so say plainly whether they
    // actually changed — an unintended change to a code snippet then shows up.
    const contentChanged = canonicalJson(existing.contentBlocks ?? []) !== canonicalJson(args.content_blocks);
    const parts = existing.type === "mcq" ? "wording and options" : "wording";
    return {
        changeLog: [`Updated the ${parts} of a question; its code/table/list content ${contentChanged ? "CHANGED" : "is unchanged"}.`],
    };
}

export async function applyUpdateQuestionOptions(args: UpdateQuestionOptionsArgs, requester: Requester): Promise<QuestionReviewResult> {
    const existing = await getQuestionById(args.question_id, requester);
    if (existing.type !== "mcq") throw new Error("Only MCQ questions have options — this question is descriptive.");

    await assertMcqAnswersAreCorrect([
        {
            questionText: existing.description,
            contentBlocks: existing.contentBlocks,
            options: args.options.map((opt, i) => ({ label: OPTION_LETTERS[i]!, text: opt.text })),
            claimedCorrectOption: args.correct_option,
        },
    ]);

    await updateQuestion(
        args.question_id,
        { options: args.options.map((opt, i) => ({ value: opt.text, isCode: opt.isCode, isCorrect: OPTION_LETTERS[i] === args.correct_option })) as any },
        requester
    );
    return { changeLog: ["Updated the options for a question."] };
}
