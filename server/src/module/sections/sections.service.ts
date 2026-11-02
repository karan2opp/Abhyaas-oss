import { eq } from "drizzle-orm";
import db from "../../common/db/index.js";
import { sections, questions, options, blocks } from "../../common/db/schema.js";
import { ApiError } from "../../common/utils/ApiError.js";
import { PermissionService, type Requester } from "../../common/permissions/index.js";
import type { CreateSectionDto, UpdateSectionDto } from "./dto/section.dto.js";

// ── Create Section ─────────────────────────────────────────────────────────────
const createSection = async (data: CreateSectionDto, requester: Requester) => {
    // verify the requester (the exam's creator) can manage this exam
    const hasAccess = await PermissionService.canManageExam(requester, data.examId);
    if (!hasAccess) throw ApiError.forbidden("You are not authorized to create a section for this exam");

    const [section] = await db.insert(sections).values({
        title: data.title,
        examId: data.examId,
    }).returning();

    if (!section) throw ApiError.internal("Failed to create section");
    return section;
};

// ── Get All Sections of an Exam (teacher) ──────────────────────────────
const getSectionsByExam = async (examId: string, requester: Requester) => {
    const hasAccess = await PermissionService.canManageExam(requester, examId);
    if (!hasAccess) throw ApiError.forbidden("You are not authorized to view this exam's sections");

    const result = await db.select().from(sections).where(eq(sections.examId, examId));
    return result;
};

// ── Get Sections with Questions and Options (teacher full view) ────────
const getSectionsWithDetails = async (examId: string, requester: Requester) => {
    const hasAccess = await PermissionService.canManageExam(requester, examId);
    if (!hasAccess) throw ApiError.forbidden("You are not authorized to view this exam's details");

    const sectionsData = await db.select().from(sections).where(eq(sections.examId, examId));

    // fetch blocks, questions and options for each section
    const sectionsWithDetails = await Promise.all(
        sectionsData.map(async (section) => {
            const blocksData = await db.select().from(blocks)
                .where(eq(blocks.sectionId, section.id))
                .orderBy(blocks.position);

            const blocksWithQuestions = await Promise.all(
                blocksData.map(async (block) => {
                    // Ordered by the explicit position column — this is what
                    // the UI numbers "Q1, Q2, ..." by (per section) and what
                    // the review agent's per-section question numbers must
                    // match exactly. created_at can't serve this: a whole
                    // generation batch shares one identical transaction
                    // timestamp, so it isn't actually a deterministic order.
                    const blockQuestions = await db.select().from(questions).where(eq(questions.blockId, block.id)).orderBy(questions.position);
                    const questionsWithOptions = await Promise.all(
                        blockQuestions.map(async (question) => {
                            const optionsData = await db.select().from(options).where(eq(options.questionId, question.id));
                            return { ...question, options: optionsData };
                        })
                    );
                    return { ...block, questions: questionsWithOptions };
                })
            );

            // All questions for the section (flattened, for backward-compatible
            // readers that still expect sections[].questions). Same ordering
            // reason as blockQuestions above — this is the array the client
            // numbers "Q1, Q2, ..." from.
            const sectionQuestions = await db.select().from(questions).where(eq(questions.sectionId, section.id)).orderBy(questions.position);
            const allQuestionsWithOptions = await Promise.all(
                sectionQuestions.map(async (question) => {
                    const optionsData = await db.select().from(options).where(eq(options.questionId, question.id));
                    return { ...question, options: optionsData };
                })
            );

            return { ...section, blocks: blocksWithQuestions, questions: allQuestionsWithOptions };
        })
    );

    return sectionsWithDetails;
};

// ── Update Section ─────────────────────────────────────────────────────────────
const updateSection = async (sectionId: string, data: UpdateSectionDto, requester: Requester) => {
    const hasAccess = await PermissionService.canManageSection(requester, sectionId);
    if (!hasAccess) throw ApiError.forbidden("You are not authorized to update this section");

    const [updated] = await db.update(sections)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(sections.id, sectionId))
        .returning();

    return updated;
};

// ── Delete Section (cascades questions + options) ──────────────────────────────
const deleteSection = async (sectionId: string, requester: Requester) => {
    const hasAccess = await PermissionService.canManageSection(requester, sectionId);
    if (!hasAccess) throw ApiError.forbidden("You are not authorized to delete this section");

    await db.delete(sections).where(eq(sections.id, sectionId));
    // questions and options are cascade deleted automatically by PostgreSQL
};

export { createSection, getSectionsByExam, getSectionsWithDetails, updateSection, deleteSection };
