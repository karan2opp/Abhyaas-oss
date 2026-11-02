import type { CreateAnswerDto } from "./dto/answer.dto.js";
import { submissions } from "../submissions/submission.schema.js";
import { eq, inArray, and } from "drizzle-orm";
import db from "../../common/db/index.js";
import { ApiError } from "../../common/utils/ApiError.js";
import { questions } from "../questions/question.schema.js";
import { options } from "../options/option.schema.js";
import { sections } from "../sections/section.schema.js";
import { answers } from "./answer.schema.js";
import { ApiResponse } from "../../common/utils/ApiResponse.js";
const validateSubmitedAnswer = async (input: {
    submissionId: string;
    questionId: string;
    userId: string;
    optionIds?: string[];
}) => {
    const { submissionId, questionId, userId, optionIds } = input;

    // ── 1. Submission exists ──────────────────────────────────────
    const [submission] = await db
        .select()
        .from(submissions)
        .where(eq(submissions.id, submissionId))
        .limit(1);

    if (!submission) {
        throw ApiError.notFound(`Submission '${submissionId}' not found`);
    }

    if (submission.userId !== userId) {
        throw ApiError.forbidden(`You are not authorized to submit answers for this submission`);
    }

    // ── 2. Submission is still open (only inprogress allows writes) ─
    if (submission.status !== "inprogress") {
        throw ApiError.forbidden(
            `Submission '${submissionId}' is already ${submission.status}`
        );
    }

    // ── 3. Question exists and belongs to the same exam ───────────
    const [question] = await db
        .select({
            id: questions.id,
            type: questions.type,
            marks: questions.marks,
            examId: sections.examId,
        })
        .from(questions)
        .innerJoin(sections, eq(questions.sectionId, sections.id))
        .where(eq(questions.id, questionId))
        .limit(1);

    if (!question) {
        throw ApiError.notFound(`Question '${questionId}' not found`);
    }

    if (question.examId !== submission.examId) {
        throw ApiError.notFound(`Question '${questionId}' does not belong to this exam`);
    }

    // ── 4. All option IDs are valid for this question ─────────────
    if (optionIds && optionIds.length > 0) {
        const foundOptions = await db
            .select({ id: options.id, questionId: options.questionId })
            .from(options)
            .where(inArray(options.id, optionIds));

        if (foundOptions.length !== optionIds.length) {
            const foundIds = new Set(foundOptions.map((o) => o.id));
            const missing = optionIds.filter((id) => !foundIds.has(id));
            throw ApiError.badRequest(`Option(s) not found: ${missing.join(", ")}`);
        }

        const wrongQuestion = foundOptions.filter((o) => o.questionId !== questionId);
        if (wrongQuestion.length > 0) {
            throw ApiError.badRequest(
                `Option(s) do not belong to question '${questionId}': ${wrongQuestion.map((o) => o.id).join(", ")}`
            );
        }
    }

    return { submission, question };
};

const submitAnswer = async (input: CreateAnswerDto, userId: string) => {
    const { questionId, submissionId, options: selectedOptions, textAnswer } = input;

    const { submission, question } = await validateSubmitedAnswer({
        submissionId,
        questionId,
        userId,
        optionIds: selectedOptions || [],
    });

    // ── Evaluate correctness (MCQ only) ──────────────────────────
    let isCorrect: boolean | null = null;
    let marksAwarded: number = 0;

    if (question.type === "mcq") {
        const correctOptions = await db
            .select({ id: options.id })
            .from(options)
            .where(
                and(
                    eq(options.questionId, questionId),
                    eq(options.isCorrect, true)
                )
            );

        const correctOptionIds = correctOptions.map((o) => o.id).sort();
        const normalizedSelected = [...(selectedOptions ?? [])].sort();

        isCorrect =
            JSON.stringify(normalizedSelected) === JSON.stringify(correctOptionIds);
        marksAwarded = isCorrect ? question.marks : 0;
    }

    // ── Upsert (atomic, race-safe) ───────────────────────────────
    const [answerRow] = await db
        .insert(answers)
        .values({
            submissionId,
            questionId,
            options: selectedOptions ?? [],
            textAnswer: textAnswer ?? null,
            isCorrect,
            marksAwarded,
            createdAt: new Date(),
            updatedAt: new Date(),
        })
        .onConflictDoUpdate({
            target: [answers.submissionId, answers.questionId],
            set: {
                options: selectedOptions ?? [],
                textAnswer: textAnswer ?? null,
                isCorrect,
                marksAwarded,
                updatedAt: new Date(),
            },
        })
        .returning();

    return {
        data: answerRow,
        isCorrect,
        marksAwarded,
    };
};

export { submitAnswer };