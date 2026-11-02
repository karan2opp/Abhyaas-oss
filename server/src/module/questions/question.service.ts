import { eq, and, inArray, sql } from "drizzle-orm";
import db from "../../common/db/index.js";
import { questions, options, sections, exams } from "../../common/db/schema.js";
import { ApiError } from "../../common/utils/ApiError.js";
import { PermissionService, type Requester } from "../../common/permissions/index.js";
import type { CreateQuestionDto, UpdateQuestionDto } from "./dto/question.dto.js";
import { uploadToCloudinary } from "../../common/config/cloudinary.js";
// ── Helper: verify section is manageable by the requester (the exam's creator) ─
const verifySectionAccess = async (sectionId: string, requester: Requester) => {
    const [section] = await db.select({
        id: sections.id,
        examId: sections.examId,
    })
        .from(sections)
        .where(eq(sections.id, sectionId));

    if (!section) throw ApiError.notFound("Section not found");

    const hasAccess = await PermissionService.canManageExam(requester, section.examId);
    if (!hasAccess) throw ApiError.forbidden("You are not authorized");
    return section;
};

// ── Helper: verify question is manageable by the requester (the exam's creator) ─
const verifyQuestionAccess = async (questionId: string, requester: Requester) => {
    const [question] = await db.select({
        id: questions.id,
        sectionId: questions.sectionId,
        blockId: questions.blockId,
        position: questions.position,
        type: questions.type,
        description: questions.description,
        marks: questions.marks,
        contentBlocks: questions.contentBlocks,
        createdAt: questions.createdAt,
        updatedAt: questions.updatedAt,
        examId: sections.examId,
    })
        .from(questions)
        .innerJoin(sections, eq(questions.sectionId, sections.id))
        .where(eq(questions.id, questionId));

    if (!question) throw ApiError.notFound("Question not found");

    const hasAccess = await PermissionService.canManageExam(requester, question.examId);
    if (!hasAccess) throw ApiError.forbidden("You are not authorized");
    return question;
};

const recalculateExamTotalMarks = async (examId: string, tx: any = db) => {
    const sectionsList = await tx.select({ id: sections.id })
        .from(sections)
        .where(eq(sections.examId, examId));
    
    if (sectionsList.length === 0) {
        await tx.update(exams).set({ totalMarks: 0, updatedAt: new Date() }).where(eq(exams.id, examId));
        return;
    }

    const sectionIds = sectionsList.map((s: any) => s.id);
    const questionsList = await tx.select({ marks: questions.marks })
        .from(questions)
        .where(inArray(questions.sectionId, sectionIds));

    const totalMarks = questionsList.reduce((sum: number, q: any) => sum + (q.marks || 0), 0);

    await tx.update(exams)
        .set({ totalMarks, updatedAt: new Date() })
        .where(eq(exams.id, examId));
};

// ── Create Question ────────────────────────────────────────────────────────────
const createQuestion = async (
    data: CreateQuestionDto,
    requester: Requester,
    imageFiles?: Express.Multer.File[]
) => {
    const section = await verifySectionAccess(data.sectionId, requester);

    const uploadedImages: { url: string; publicId: string }[] = [];

    if (imageFiles && imageFiles.length > 0) {
        const uploadPromises = imageFiles.map((file) =>
            uploadToCloudinary(file.buffer, "questions")
        );
        const results = await Promise.all(uploadPromises);
        uploadedImages.push(...results.map((r) => ({ url: r.url, publicId: r.publicId })));
    }

    const result = await db.transaction(async (tx) => {
        // Next position in this SECTION's list (spanning every block in it,
        // matching how the UI numbers "Q1, Q2, ..." per section) — read
        // inside the same transaction as the insert below so a concurrent
        // add can't compute the same next position twice.
        const positionRows = await tx
            .select({ nextPosition: sql<number>`coalesce(max(${questions.position}), -1) + 1` })
            .from(questions)
            .where(eq(questions.sectionId, data.sectionId));
        // An aggregate with no GROUP BY always returns exactly one row, even
        // over an empty set — this fallback is only for the type checker.
        const nextPosition = positionRows[0]?.nextPosition ?? 0;

        const [question] = await tx.insert(questions).values({
            sectionId: data.sectionId,
            blockId: data.blockId ?? null,
            type: data.type,
            description: data.description,
            marks: data.marks,
            // The review agent passes the replaced question's position so a
            // replacement keeps its place; every other caller appends.
            position: typeof (data as any).position === "number" ? (data as any).position : nextPosition,
            images: uploadedImages.length > 0 ? uploadedImages : null,
            rubric: data.rubric ?? null,
            // Not yet on CreateQuestionDto (the manual editor doesn't send
            // this — see question.dto.ts), but the Question Review Agent's
            // generate-questions tool calls this function with it directly,
            // so it has to be read defensively rather than dropped.
            contentBlocks: (data as any).contentBlocks ?? [],
            // Set by the AI paths (add-topic, the review agent) so the question stays tied to the topic it came from.
            topic: (data as any).topic ?? null,
            subtopic: (data as any).subtopic ?? null,
        }).returning();

        if (!question) throw ApiError.internal("Failed to create question");

        let optionsData: typeof options.$inferSelect[] = [];

        if (data.type === "mcq" && data.options && data.options.length > 0) {
            optionsData = await tx.insert(options).values(
                data.options.map(opt => ({
                    questionId: question.id,
                    value: opt.value,
                    isCorrect: opt.isCorrect,
                    // Same as contentBlocks above — not on the DTO yet, read
                    // defensively for the review agent's generate tool.
                    isCode: (opt as any).isCode ?? false,
                }))
            ).returning();
        }

        await recalculateExamTotalMarks(section.examId, tx);

        return { ...question, options: optionsData };
    });

    return result;
};

// ── Get All Questions by Section ───────────────────────────────────────────────
const getQuestionsBySection = async (sectionId: string, requester: Requester) => {
    await verifySectionAccess(sectionId, requester);

    const questionsData = await db.select().from(questions).where(eq(questions.sectionId, sectionId)).orderBy(questions.position);

    const questionsWithOptions = await Promise.all(
        questionsData.map(async (question) => {
            const optionsData = await db.select().from(options).where(eq(options.questionId, question.id));
            return { ...question, options: optionsData };
        })
    );

    return questionsWithOptions;
};

// ── Get Single Question with Options ──────────────────────────────────────────
const getQuestionById = async (questionId: string, requester: Requester) => {
    const question = await verifyQuestionAccess(questionId, requester);
    const optionsData = await db.select().from(options).where(eq(options.questionId, questionId));
    return { ...question, options: optionsData };
};

// ── Update Question (with smart options merge) ─────────────────────────────────
const updateQuestion = async (questionId: string, data: UpdateQuestionDto, requester: Requester, imageFiles?: Express.Multer.File[]) => {
    const question = await verifyQuestionAccess(questionId, requester);

    const uploadedImages: { url: string; publicId: string }[] = [];

    if (imageFiles && imageFiles.length > 0) {
        const uploadPromises = imageFiles.map((file) =>
            uploadToCloudinary(file.buffer, "questions")
        );
        const results = await Promise.all(uploadPromises);
        uploadedImages.push(...results.map((r) => ({ url: r.url, publicId: r.publicId })));
    }

    const result = await db.transaction(async (tx) => {
        // update question fields
        const [updated] = await tx.update(questions)
            .set({
                ...(data.description && { description: data.description }),
                ...(data.marks && { marks: data.marks }),
                ...(uploadedImages.length > 0 && { images: uploadedImages }),
                ...(data.rubric !== undefined && { rubric: data.rubric }),
                // Not on UpdateQuestionDto yet (see contentBlocks in
                // createQuestion above) — read defensively for the review
                // agent's update_question tool.
                ...((data as any).contentBlocks !== undefined && { contentBlocks: (data as any).contentBlocks }),
                updatedAt: new Date(),
            })
            .where(eq(questions.id, questionId))
            .returning();

        if (!updated) throw ApiError.internal("Failed to update question");

        if (data.options && data.options.length > 0) {
            // separate options into update and create
            const toUpdate = data.options.filter(opt => opt.id)
            const toCreate = data.options.filter(opt => !opt.id)

            // ids included in request — keep these
            const incomingIds = toUpdate.map(opt => opt.id as string)

            // delete options not included in request
            const existingOptions = await tx.select().from(options).where(eq(options.questionId, questionId))
            const toDelete = existingOptions.filter(opt => !incomingIds.includes(opt.id))

            if (toDelete.length > 0) {
                await tx.delete(options).where(
                    inArray(options.id, toDelete.map(opt => opt.id))
                )
            }

            // update existing options
            await Promise.all(
                toUpdate.map(opt =>
                    tx.update(options)
                        .set({
                            value: opt.value,
                            isCorrect: opt.isCorrect,
                            // Only touched when the caller actually sent it —
                            // an edit that doesn't mention isCode must leave
                            // an existing option's code-flag exactly as it was.
                            ...("isCode" in opt && (opt as any).isCode !== undefined && { isCode: (opt as any).isCode }),
                            updatedAt: new Date(),
                        })
                        .where(eq(options.id, opt.id as string))
                )
            )

            // create new options
            if (toCreate.length > 0) {
                await tx.insert(options).values(
                    toCreate.map(opt => ({
                        questionId,
                        value: opt.value!,
                        isCorrect: opt.isCorrect!,
                        isCode: (opt as any).isCode ?? false,
                    }))
                )
            }
        }

        await recalculateExamTotalMarks(question.examId, tx);

        const updatedOptions = await tx.select().from(options).where(eq(options.questionId, questionId))
        return { ...updated, options: updatedOptions };
    });

    return result;
};

// ── Delete Question (cascades options) ────────────────────────────────────────
const deleteQuestion = async (questionId: string, requester: Requester) => {
    const question = await verifyQuestionAccess(questionId, requester);
    await db.transaction(async (tx) => {
        await tx.delete(questions).where(eq(questions.id, questionId));
        await recalculateExamTotalMarks(question.examId, tx);
    });
};
export { createQuestion, recalculateExamTotalMarks, getQuestionsBySection, getQuestionById, updateQuestion, deleteQuestion };