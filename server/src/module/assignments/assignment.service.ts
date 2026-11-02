import { eq, and, or, inArray, isNull, ilike, desc, count, lt, gt, lte, gte } from "drizzle-orm";
import db from "../../common/db/index.js";
import {
    assignments,
    assignmentSeries,
    assignmentQuestions,
    assignmentOptions,
    assignmentSubmissions,
    assignmentAnswers,
    assignmentEnrollments,
    users,
    blocks,
} from "../../common/db/schema.js";
import { ApiError } from "../../common/utils/ApiError.js";
import { PermissionService } from "../../common/permissions/index.js";
import { generateJoinCode } from "../../common/utils/joinCode.js";
import { evaluateAnswer, type TextAnswer } from "../evalutaion/evalutaion.js";
import type {
    CreateSeriesDto,
    UpdateSeriesDto,
    CreateAssignmentDto,
    UpdateAssignmentDto,
    ExtendAssignmentDto,
    CreateAssignmentQuestionDto,
    UpdateAssignmentQuestionDto,
    SaveAssignmentAnswerDto,
    GradeAssignmentSubmissionDto,
} from "./dto/assignment.dto.js";

const DAY_MS = 24 * 60 * 60 * 1000;

// ── Unique join code (shared by standalone assignments and series) ────────────
// One student-facing "enter code" box covers both, so a code must be unused in
// either table.
const createUniqueJoinCode = async (): Promise<string> => {
    while (true) {
        const code = generateJoinCode();
        const [inAssignments] = await db.select({ id: assignments.id }).from(assignments).where(eq(assignments.joinCode, code));
        const [inSeries] = await db.select({ id: assignmentSeries.id }).from(assignmentSeries).where(eq(assignmentSeries.joinCode, code));
        if (!inAssignments && !inSeries) return code;
    }
};

// ── Create Series ─────────────────────────────────────────────────────────────
const createSeries = async (data: CreateSeriesDto, teacherId: string) => {
    const [series] = await db.insert(assignmentSeries).values({
        title: data.title,
        type: data.type,
        joinCode: await createUniqueJoinCode(),
        createdBy: teacherId,
    }).returning();

    if (!series) throw ApiError.internal("Failed to create series");
    return series;
};

// ── List Series (the teacher's own) ───────────────────────────────────────────
const listMySeries = async (teacherId: string) => {
    return await db.select().from(assignmentSeries)
        .where(eq(assignmentSeries.createdBy, teacherId))
        .orderBy(desc(assignmentSeries.createdAt));
};

// ── Update Series (rename) ──────────────────────────────────────────────────────
const updateSeries = async (seriesId: string, data: UpdateSeriesDto, teacherId: string) => {
    const [series] = await db.select().from(assignmentSeries).where(eq(assignmentSeries.id, seriesId));
    if (!series) throw ApiError.notFound("Series not found");

    const hasAccess = await PermissionService.teacher.canManageSeries(teacherId, seriesId);
    if (!hasAccess) throw ApiError.forbidden("You are not authorized to update this series");

    const [updated] = await db.update(assignmentSeries)
        .set({ title: data.title, updatedAt: new Date() })
        .where(eq(assignmentSeries.id, seriesId))
        .returning();

    return updated;
};

// ── Delete Series (cascades its assignments) ──────────────────────────────────
const deleteSeries = async (seriesId: string, teacherId: string) => {
    const [series] = await db.select().from(assignmentSeries).where(eq(assignmentSeries.id, seriesId));
    if (!series) throw ApiError.notFound("Series not found");

    const hasAccess = await PermissionService.teacher.canManageSeries(teacherId, seriesId);
    if (!hasAccess) throw ApiError.forbidden("You are not authorized to delete this series");

    await db.delete(assignmentSeries).where(eq(assignmentSeries.id, seriesId));
};

// ── Create Assignment ────────────────────────────────────────────────────────
const createAssignment = async (data: CreateAssignmentDto, teacherId: string) => {
    let sequenceOrder: number | null = null;
    let unlockOffsetDays: number | null = null;
    let dayGap: number | null = null;
    let startDate: Date | null = data.startDate ?? null;
    let dueDate: Date | null = data.dueDate ?? null;

    if (data.seriesId) {
        const [series] = await db.select().from(assignmentSeries).where(eq(assignmentSeries.id, data.seriesId));
        if (!series) throw ApiError.notFound("Series not found");
        if (series.createdBy !== teacherId) throw ApiError.forbidden("You are not authorized to add assignments to this series");

        // Chain from the last assignment currently in this series.
        const existing = await db.select().from(assignments).where(eq(assignments.seriesId, data.seriesId));
        const last = existing.length > 0
            ? existing.reduce((a, b) => ((a.sequenceOrder ?? 0) > (b.sequenceOrder ?? 0) ? a : b))
            : null;
        sequenceOrder = (last?.sequenceOrder ?? 0) + 1;

        if (series.type === "weekly") {
            if (!data.dayGap) throw ApiError.badRequest("dayGap is required for a weekly series assignment");
            if (data.dueDate) throw ApiError.badRequest("Weekly series assignments use dayGap, not a manual due date");
            dayGap = data.dayGap;
            // starts the day after the previous one ends (relative to each student's enrollment)
            unlockOffsetDays = last ? (last.unlockOffsetDays ?? 0) + (last.dayGap ?? 0) + 1 : 0;
            startDate = null;
            dueDate = null;
        } else {
            if (!data.startDate || !data.dueDate) throw ApiError.badRequest("startDate and dueDate are required for a custom series assignment");
            if (data.dayGap) throw ApiError.badRequest("Custom series assignments use explicit dates, not dayGap");
            startDate = data.startDate;
            dueDate = data.dueDate;
        }
    }

    const [assignment] = await db.insert(assignments).values({
        title: data.title,
        instructions: data.instructions,
        // Series assignments are reached through the series' code instead.
        joinCode: data.seriesId ? null : await createUniqueJoinCode(),
        createdBy: teacherId,
        totalMarks: data.totalMarks ?? 0,
        startDate,
        dueDate,
        seriesId: data.seriesId ?? null,
        dayGap,
        sequenceOrder,
        unlockOffsetDays,
    }).returning();

    if (!assignment) throw ApiError.internal("Failed to create assignment");

    // Persist optional generated blocks + questions in one transaction.
    const blocksToPersist = data.blocks;
    if (blocksToPersist && blocksToPersist.length > 0) {
        await db.transaction(async (tx) => {
            let totalMarks = 0;
            for (const [bIdx, blockData] of blocksToPersist.entries()) {
                const [block] = await tx.insert(blocks).values({
                    assignmentId: assignment.id,
                    name: blockData.name,
                    subject: blockData.subject,
                    questionType: blockData.questionType,
                    questionCount: blockData.questions?.length ?? 0,
                    totalMarks: blockData.totalMarks ?? 0,
                    instructions: blockData.instructions ?? [],
                    position: bIdx,
                }).returning();

                if (!block) throw ApiError.internal("Failed to create block");

                for (const qData of blockData.questions || []) {
                    const [question] = await tx.insert(assignmentQuestions).values({
                        assignmentId: assignment.id,
                        blockId: block.id,
                        type: qData.type,
                        description: qData.description,
                        marks: qData.marks,
                        modelAnswer: qData.modelAnswer,
                        rubric: qData.rubric ?? null,
                    }).returning();

                    if (!question) throw ApiError.internal("Failed to create question");
                    totalMarks += Number(qData.marks) || 0;

                    if (qData.type === "mcq" && qData.options && qData.options.length > 0) {
                        await tx.insert(assignmentOptions).values(
                            qData.options.map(opt => ({
                                questionId: question.id,
                                value: opt.value,
                                isCorrect: opt.isCorrect,
                            }))
                        );
                    }
                }
            }

            if (totalMarks > 0) {
                await tx.update(assignments)
                    .set({ totalMarks, updatedAt: new Date() })
                    .where(eq(assignments.id, assignment.id));
            }
        });
    }

    return assignment;
};

// ── Extend Assignment (grow duration or shift window, with optional cascade) ──
const extendAssignment = async (assignmentId: string, data: ExtendAssignmentDto, teacherId: string) => {
    const hasAccess = await PermissionService.teacher.canManageAssignment(teacherId, assignmentId);
    if (!hasAccess) throw ApiError.forbidden("You are not authorized to modify this assignment");

    const [assignment] = await db.select().from(assignments).where(eq(assignments.id, assignmentId));
    if (!assignment) throw ApiError.notFound("Assignment not found");
    if (!assignment.seriesId || assignment.sequenceOrder === null) {
        throw ApiError.badRequest("Only series assignments can be extended this way");
    }

    const [series] = await db.select().from(assignmentSeries).where(eq(assignmentSeries.id, assignment.seriesId));
    if (!series) throw ApiError.notFound("Series not found");

    if (series.type === "weekly") {
        return await db.transaction(async (tx) => {
            let updatedFields: { dayGap?: number; unlockOffsetDays?: number };

            if (data.mode === "grow") {
                // Due date pushes out by `days`; start stays put.
                updatedFields = { dayGap: (assignment.dayGap ?? 0) + data.days };
            } else {
                // Whole window slides later by `days`; duration unchanged.
                updatedFields = { unlockOffsetDays: (assignment.unlockOffsetDays ?? 0) + data.days };
            }

            const [updated] = await tx.update(assignments)
                .set({ ...updatedFields, updatedAt: new Date() })
                .where(eq(assignments.id, assignmentId))
                .returning();

            if (!updated) throw ApiError.internal("Failed to extend assignment");

            if (data.cascade) {
                const later = await tx.select().from(assignments).where(eq(assignments.seriesId, assignment.seriesId!));
                const sorted = later
                    .filter(a => (a.sequenceOrder ?? 0) > (updated.sequenceOrder ?? 0))
                    .sort((a, b) => (a.sequenceOrder ?? 0) - (b.sequenceOrder ?? 0));

                let cursorOffset = (updated.unlockOffsetDays ?? 0) + (updated.dayGap ?? 0) + 1;
                for (const a of sorted) {
                    await tx.update(assignments)
                        .set({ unlockOffsetDays: cursorOffset, updatedAt: new Date() })
                        .where(eq(assignments.id, a.id));
                    cursorOffset = cursorOffset + (a.dayGap ?? 0) + 1;
                }
            }

            return updated;
        });
    }

    // Custom series: dates are fixed columns shared by every student, not offsets.
    if (!assignment.startDate || !assignment.dueDate) {
        throw ApiError.badRequest("This assignment doesn't have dates set yet");
    }

    return await db.transaction(async (tx) => {
        const extraMs = data.days * DAY_MS;
        const newStartDate = data.mode === "shift" ? new Date(assignment.startDate!.getTime() + extraMs) : assignment.startDate!;
        const newDueDate = new Date(assignment.dueDate!.getTime() + extraMs);

        const [updated] = await tx.update(assignments)
            .set({ startDate: newStartDate, dueDate: newDueDate, updatedAt: new Date() })
            .where(eq(assignments.id, assignmentId))
            .returning();

        if (!updated) throw ApiError.internal("Failed to extend assignment");

        if (data.cascade) {
            const later = await tx.select().from(assignments).where(eq(assignments.seriesId, assignment.seriesId!));
            const sorted = later
                .filter(a => (a.sequenceOrder ?? 0) > (updated.sequenceOrder ?? 0))
                .sort((a, b) => (a.sequenceOrder ?? 0) - (b.sequenceOrder ?? 0));

            let cursorDue = updated.dueDate!;
            for (const a of sorted) {
                const duration = a.startDate && a.dueDate ? a.dueDate.getTime() - a.startDate.getTime() : 0;
                const nextStart = new Date(cursorDue.getTime() + DAY_MS);
                const nextDue = new Date(nextStart.getTime() + duration);
                await tx.update(assignments)
                    .set({ startDate: nextStart, dueDate: nextDue, updatedAt: new Date() })
                    .where(eq(assignments.id, a.id));
                cursorDue = nextDue;
            }
        }

        return updated;
    });
};

// ── Update Assignment ────────────────────────────────────────────────────────
const updateAssignment = async (assignmentId: string, data: UpdateAssignmentDto, teacherId: string) => {
    const hasAccess = await PermissionService.teacher.canManageAssignment(teacherId, assignmentId);
    if (!hasAccess) throw ApiError.forbidden("You are not authorized to update this assignment");

    const [existing] = await db.select().from(assignments).where(eq(assignments.id, assignmentId));
    if (!existing) throw ApiError.notFound("Assignment not found");

    // Weekly series assignments have their schedule computed and chained from
    // dayGap/unlockOffsetDays — use extendAssignment to change it, not a plain
    // update. Custom series assignments store fixed dates directly, so those
    // can be edited here like a standalone assignment (dayGap never applies).
    if (existing.seriesId) {
        const [series] = await db.select().from(assignmentSeries).where(eq(assignmentSeries.id, existing.seriesId));
        const isWeekly = series?.type === "weekly";
        if (isWeekly && (data.startDate !== undefined || data.dueDate !== undefined || data.dayGap !== undefined)) {
            throw ApiError.badRequest("Use the extend action to change a weekly series assignment's schedule");
        }
        if (!isWeekly && data.dayGap !== undefined) {
            throw ApiError.badRequest("Custom series assignments don't use dayGap");
        }
    }

    const [updated] = await db.update(assignments)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(assignments.id, assignmentId))
        .returning();

    return updated;
};

// ── Delete Assignment ────────────────────────────────────────────────────────
const deleteAssignment = async (assignmentId: string, teacherId: string) => {
    const hasAccess = await PermissionService.teacher.canManageAssignment(teacherId, assignmentId);
    if (!hasAccess) throw ApiError.forbidden("You are not authorized to delete this assignment");

    await db.delete(assignments).where(eq(assignments.id, assignmentId));
};

// ── List Assignments (the teacher's own) ─────────────────────────────────────
const listMyAssignments = async (
    teacherId: string,
    options?: {
        standaloneOnly?: boolean | undefined;
        search?: string | undefined;
        status?: "upcoming" | "live" | "closed" | undefined;
        page?: number | undefined;
        limit?: number | undefined;
    }
) => {
    const conditions = [eq(assignments.createdBy, teacherId)];
    if (options?.standaloneOnly) conditions.push(isNull(assignments.seriesId));
    if (options?.search) conditions.push(ilike(assignments.title, `%${options.search}%`));

    // Only meaningful for assignments with a fixed date (standalone / custom
    // series) — weekly-series assignments have no fixed startDate/dueDate on
    // the row itself (computed per-student), so they never match these.
    const now = new Date();
    if (options?.status === "upcoming") {
        conditions.push(gt(assignments.startDate, now));
    } else if (options?.status === "closed") {
        conditions.push(lt(assignments.dueDate, now));
    } else if (options?.status === "live") {
        conditions.push(or(isNull(assignments.startDate), lte(assignments.startDate, now))!);
        conditions.push(or(isNull(assignments.dueDate), gte(assignments.dueDate, now))!);
    }

    // Paginated form (used by the Standalone Assignments list) — opted into by
    // passing `page`. Without it, returns the full unpaginated array as before
    // (used for series grouping and landing-page counts).
    if (options?.page) {
        const page = options.page;
        const limit = options.limit ?? 10;
        const offset = (page - 1) * limit;

        const data = await db.select().from(assignments)
            .where(and(...conditions))
            .orderBy(desc(assignments.createdAt))
            .limit(limit)
            .offset(offset);

        const [totalCount] = await db.select({ value: count() }).from(assignments).where(and(...conditions));
        const total = Number(totalCount?.value) || 0;

        return { data, total, page, limit, hasMore: offset + data.length < total };
    }

    return await db.select().from(assignments).where(and(...conditions)).orderBy(desc(assignments.createdAt));
};

// ── Get Assignment By Id (teacher) ───────────────────────────────────────────
const getAssignmentById = async (assignmentId: string, teacherId: string) => {
    const hasAccess = await PermissionService.teacher.canManageAssignment(teacherId, assignmentId);
    if (!hasAccess) throw ApiError.forbidden("You are not authorized to view this assignment");

    const [assignment] = await db.select().from(assignments).where(eq(assignments.id, assignmentId));
    if (!assignment) throw ApiError.notFound("Assignment not found");
    return assignment;
};

// ── Helper: verify question belongs to an assignment the teacher can manage ───
const verifyQuestionOwnership = async (questionId: string, teacherId: string) => {
    const [question] = await db.select().from(assignmentQuestions).where(eq(assignmentQuestions.id, questionId));
    if (!question) throw ApiError.notFound("Question not found");

    const hasAccess = await PermissionService.teacher.canManageAssignment(teacherId, question.assignmentId);
    if (!hasAccess) throw ApiError.forbidden("You are not authorized to manage this question");

    return question;
};

const recalculateAssignmentTotalMarks = async (assignmentId: string, tx: any = db) => {
    const questionsList = await tx.select({ marks: assignmentQuestions.marks })
        .from(assignmentQuestions)
        .where(eq(assignmentQuestions.assignmentId, assignmentId));
    
    const totalMarks = questionsList.reduce((sum: number, q: any) => sum + (q.marks || 0), 0);

    await tx.update(assignments)
        .set({ totalMarks, updatedAt: new Date() })
        .where(eq(assignments.id, assignmentId));
};

// ── Create Question ──────────────────────────────────────────────────────────
const createQuestion = async (data: CreateAssignmentQuestionDto, teacherId: string) => {
    const hasAccess = await PermissionService.teacher.canManageAssignment(teacherId, data.assignmentId);
    if (!hasAccess) throw ApiError.forbidden("You are not authorized to add questions to this assignment");

    const result = await db.transaction(async (tx) => {
        const [question] = await tx.insert(assignmentQuestions).values({
            assignmentId: data.assignmentId,
            type: data.type,
            description: data.description,
            marks: data.marks,
            modelAnswer: data.modelAnswer,
            images: data.images ?? null,
        }).returning();

        if (!question) throw ApiError.internal("Failed to create question");

        let optionsData: typeof assignmentOptions.$inferSelect[] = [];
        if (data.type === "mcq" && data.options && data.options.length > 0) {
            optionsData = await tx.insert(assignmentOptions).values(
                data.options.map(opt => ({
                    questionId: question.id,
                    value: opt.value,
                    isCorrect: opt.isCorrect,
                }))
            ).returning();
        }

        await recalculateAssignmentTotalMarks(data.assignmentId, tx);

        return { ...question, options: optionsData };
    });

    return result;
};

// ── Update Question (with smart options merge) ───────────────────────────────
const updateQuestion = async (questionId: string, data: UpdateAssignmentQuestionDto, teacherId: string) => {
    await verifyQuestionOwnership(questionId, teacherId);

    const result = await db.transaction(async (tx) => {
        const [updated] = await tx.update(assignmentQuestions)
            .set({
                ...(data.description && { description: data.description }),
                ...(data.marks && { marks: data.marks }),
                ...(data.modelAnswer !== undefined && { modelAnswer: data.modelAnswer }),
                ...(data.images && { images: data.images }),
                updatedAt: new Date(),
            })
            .where(eq(assignmentQuestions.id, questionId))
            .returning();

        if (!updated) throw ApiError.internal("Failed to update question");

        if (data.options && data.options.length > 0) {
            const toUpdate = data.options.filter(opt => opt.id);
            const toCreate = data.options.filter(opt => !opt.id);
            const incomingIds = toUpdate.map(opt => opt.id as string);

            const existingOptions = await tx.select().from(assignmentOptions).where(eq(assignmentOptions.questionId, questionId));
            const toDelete = existingOptions.filter(opt => !incomingIds.includes(opt.id));

            if (toDelete.length > 0) {
                await tx.delete(assignmentOptions).where(inArray(assignmentOptions.id, toDelete.map(opt => opt.id)));
            }

            await Promise.all(
                toUpdate.map(opt =>
                    tx.update(assignmentOptions)
                        .set({ value: opt.value, isCorrect: opt.isCorrect, updatedAt: new Date() })
                        .where(eq(assignmentOptions.id, opt.id as string))
                )
            );

            if (toCreate.length > 0) {
                await tx.insert(assignmentOptions).values(
                    toCreate.map(opt => ({ questionId, value: opt.value!, isCorrect: opt.isCorrect! }))
                );
            }
        }

        await recalculateAssignmentTotalMarks(updated.assignmentId, tx);

        const updatedOptions = await tx.select().from(assignmentOptions).where(eq(assignmentOptions.questionId, questionId));
        return { ...updated, options: updatedOptions };
    });

    return result;
};

// ── Delete Question (cascades options) ───────────────────────────────────────
const deleteQuestion = async (questionId: string, teacherId: string) => {
    const question = await verifyQuestionOwnership(questionId, teacherId);
    await db.transaction(async (tx) => {
        await tx.delete(assignmentQuestions).where(eq(assignmentQuestions.id, questionId));
        await recalculateAssignmentTotalMarks(question.assignmentId, tx);
    });
};

// ── Get Questions (teacher, full view incl. correct answers) ────────────────
const getQuestionsForTeacher = async (assignmentId: string, teacherId: string) => {
    const hasAccess = await PermissionService.teacher.canManageAssignment(teacherId, assignmentId);
    if (!hasAccess) throw ApiError.forbidden("You are not authorized to view this assignment");

    const questionsData = await db.select().from(assignmentQuestions).where(eq(assignmentQuestions.assignmentId, assignmentId));
    return await Promise.all(questionsData.map(async (question) => {
        const optionsData = await db.select().from(assignmentOptions).where(eq(assignmentOptions.questionId, question.id));
        return { ...question, options: optionsData };
    }));
};

// ── Helper: the student's enrollment that grants access to an assignment ─────
// A standalone assignment is joined directly; a series assignment through its series.
const findEnrollment = async (assignment: typeof assignments.$inferSelect, studentId: string) => {
    const target = assignment.seriesId
        ? eq(assignmentEnrollments.seriesId, assignment.seriesId)
        : eq(assignmentEnrollments.assignmentId, assignment.id);
    const [enrollment] = await db.select().from(assignmentEnrollments).where(
        and(eq(assignmentEnrollments.studentId, studentId), target)
    );
    return enrollment ?? null;
};

// ── Helper: verify a student has joined a given assignment (or its series) ───
const assertStudentCanAccessAssignment = async (assignmentId: string, studentId: string) => {
    const [assignment] = await db.select().from(assignments).where(eq(assignments.id, assignmentId));
    if (!assignment) throw ApiError.notFound("Assignment not found");

    const enrollment = await findEnrollment(assignment, studentId);
    if (!enrollment) throw ApiError.forbidden("Enter this assignment's join code to access it");

    return assignment;
};

// ── Join by Code (student) ───────────────────────────────────────────────────
// The code can belong to a standalone assignment or a whole series. Joining
// twice is harmless: the original enrollment date is kept.
const joinByCode = async (joinCode: string, studentId: string) => {
    const [assignment] = await db.select().from(assignments).where(eq(assignments.joinCode, joinCode));
    if (assignment) {
        await db.insert(assignmentEnrollments).values({ studentId, assignmentId: assignment.id }).onConflictDoNothing();
        return { type: "assignment" as const, assignmentId: assignment.id, title: assignment.title };
    }

    const [series] = await db.select().from(assignmentSeries).where(eq(assignmentSeries.joinCode, joinCode));
    if (series) {
        await db.insert(assignmentEnrollments).values({ studentId, seriesId: series.id }).onConflictDoNothing();
        return { type: "series" as const, seriesId: series.id, title: series.title };
    }

    throw ApiError.notFound("Invalid join code");
};

// ── Get Assignment By Id (student) ───────────────────────────────────────────
const getAssignmentForStudent = async (assignmentId: string, studentId: string) => {
    const assignment = await assertStudentCanAccessAssignment(assignmentId, studentId);
    const { startDate, dueDate } = await getComputedAssignmentDates(assignment, studentId);
    return { ...assignment, startDate, dueDate };
};

// ── Get Questions (student, hides correct answers/model answer) ─────────────
const getQuestionsForStudent = async (assignmentId: string, studentId: string) => {
    await assertStudentCanAccessAssignment(assignmentId, studentId);

    const questionsData = await db.select({
        id: assignmentQuestions.id,
        assignmentId: assignmentQuestions.assignmentId,
        type: assignmentQuestions.type,
        description: assignmentQuestions.description,
        images: assignmentQuestions.images,
        marks: assignmentQuestions.marks,
    }).from(assignmentQuestions).where(eq(assignmentQuestions.assignmentId, assignmentId));

    return await Promise.all(questionsData.map(async (question) => {
        const optionsData = await db.select({
            id: assignmentOptions.id,
            questionId: assignmentOptions.questionId,
            value: assignmentOptions.value,
        }).from(assignmentOptions).where(eq(assignmentOptions.questionId, question.id));
        return { ...question, options: optionsData };
    }));
};

// ── Computed start/due dates for a student (series assignments only) ─────────
// Standalone assignments already store real startDate/dueDate columns; series
// ones are relative to the day the student joined the series, so the actual
// calendar dates are derived per student here rather than stored.
const getComputedAssignmentDates = async (
    assignment: typeof assignments.$inferSelect,
    studentId: string
): Promise<{ startDate: Date | null; dueDate: Date | null }> => {
    // Standalone, or a custom-series assignment (fixed dates for everyone,
    // identifiable by unlockOffsetDays never having been set) — use the
    // stored columns directly. Only weekly-series assignments are computed
    // relative to the student's enrollment date.
    if (!assignment.seriesId || assignment.unlockOffsetDays === null) {
        return { startDate: assignment.startDate, dueDate: assignment.dueDate };
    }

    const enrollment = await findEnrollment(assignment, studentId);
    if (!enrollment) return { startDate: null, dueDate: null };

    const startDate = new Date(enrollment.enrolledAt.getTime() + (assignment.unlockOffsetDays ?? 0) * DAY_MS);
    const dueDate = new Date(startDate.getTime() + (assignment.dayGap ?? 0) * DAY_MS);
    return { startDate, dueDate };
};

// ── Unlock status ─────────────────────────────────────────────────────────────
// Standalone assignments: locked only if a manually-set startDate is in the
// future. Series assignments: locked until (a) unlockOffsetDays have passed
// since the student joined the series, and (b) the previous assignment
// in the same series has been submitted (not just started).
const getAssignmentUnlockStatus = async (
    assignment: typeof assignments.$inferSelect,
    studentId: string
): Promise<{ locked: boolean; unlocksAt: string | null; reason: "time" | "previous_incomplete" | null }> => {
    if (!assignment.seriesId) {
        if (assignment.startDate && new Date() < assignment.startDate) {
            return { locked: true, unlocksAt: assignment.startDate.toISOString(), reason: "time" };
        }
        return { locked: false, unlocksAt: null, reason: null };
    }

    const { startDate: unlocksAt } = await getComputedAssignmentDates(assignment, studentId);
    if (!unlocksAt) return { locked: true, unlocksAt: null, reason: "time" };
    if (new Date() < unlocksAt) return { locked: true, unlocksAt: unlocksAt.toISOString(), reason: "time" };

    if (assignment.sequenceOrder === 1) return { locked: false, unlocksAt: null, reason: null };

    const [prevAssignment] = await db.select().from(assignments).where(
        and(eq(assignments.seriesId, assignment.seriesId), eq(assignments.sequenceOrder, (assignment.sequenceOrder ?? 1) - 1))
    );
    if (!prevAssignment) return { locked: false, unlocksAt: null, reason: null };

    const [prevSubmission] = await db.select().from(assignmentSubmissions).where(
        and(eq(assignmentSubmissions.assignmentId, prevAssignment.id), eq(assignmentSubmissions.studentId, studentId))
    );
    const prevCompleted = prevSubmission && (prevSubmission.status === "submitted" || prevSubmission.status === "graded");

    if (!prevCompleted) return { locked: true, unlocksAt: unlocksAt.toISOString(), reason: "previous_incomplete" };

    return { locked: false, unlocksAt: null, reason: null };
};

// ── List Assignments Visible to a Student (everything they joined) ───────────
const getMyAssignments = async (studentId: string) => {
    const enrollments = await db.select().from(assignmentEnrollments).where(eq(assignmentEnrollments.studentId, studentId));
    const assignmentIds = enrollments.flatMap(e => (e.assignmentId ? [e.assignmentId] : []));
    const seriesIds = enrollments.flatMap(e => (e.seriesId ? [e.seriesId] : []));

    const targets = [
        ...(assignmentIds.length > 0 ? [inArray(assignments.id, assignmentIds)] : []),
        ...(seriesIds.length > 0 ? [inArray(assignments.seriesId, seriesIds)] : []),
    ];
    if (targets.length === 0) return [];

    const visible = await db.select().from(assignments).where(or(...targets)).orderBy(desc(assignments.createdAt));
    if (visible.length === 0) return [];

    const mySubmissions = await db.select().from(assignmentSubmissions).where(
        and(inArray(assignmentSubmissions.assignmentId, visible.map(a => a.id)), eq(assignmentSubmissions.studentId, studentId))
    );
    const submissionByAssignment = new Map(mySubmissions.map(s => [s.assignmentId, s]));

    return await Promise.all(visible.map(async (a) => {
        const { startDate, dueDate } = await getComputedAssignmentDates(a, studentId);
        return {
            ...a,
            startDate,
            dueDate,
            submissionStatus: submissionByAssignment.get(a.id)?.status ?? null,
            ...(await getAssignmentUnlockStatus(a, studentId)),
        };
    }));
};

// ── Start Assignment (creates or resumes an in-progress submission) ─────────
const startAssignment = async (assignmentId: string, studentId: string) => {
    const assignment = await assertStudentCanAccessAssignment(assignmentId, studentId);

    const { locked, unlocksAt } = await getAssignmentUnlockStatus(assignment, studentId);
    if (locked) {
        throw ApiError.forbidden(
            unlocksAt ? `This assignment unlocks on ${new Date(unlocksAt).toLocaleDateString()}, after completing the previous one.` : "This assignment is locked."
        );
    }

    const [existing] = await db.select().from(assignmentSubmissions).where(
        and(
            eq(assignmentSubmissions.assignmentId, assignmentId),
            eq(assignmentSubmissions.studentId, studentId),
            isNull(assignmentSubmissions.deletedAt),
        )
    );
    if (existing) return existing;

    const [submission] = await db.insert(assignmentSubmissions).values({
        assignmentId,
        studentId,
        status: "in_progress",
    }).returning();

    if (!submission) throw ApiError.internal("Failed to start assignment");
    return submission;
};

// ── Save Answer (student, upserted per question while in progress) ──────────
const saveAnswer = async (data: SaveAssignmentAnswerDto, studentId: string) => {
    const [submission] = await db.select().from(assignmentSubmissions).where(eq(assignmentSubmissions.id, data.submissionId));
    if (!submission) throw ApiError.notFound("Submission not found");
    if (submission.studentId !== studentId) throw ApiError.forbidden("You are not authorized to answer for this submission");
    if (submission.status === "graded") throw ApiError.badRequest("This assignment has already been graded");
    if (submission.status === "submitted") {
        const [assignment] = await db.select().from(assignments).where(eq(assignments.id, submission.assignmentId));
        const { dueDate } = assignment ? await getComputedAssignmentDates(assignment, studentId) : { dueDate: null };
        if (dueDate && new Date() > dueDate) throw ApiError.badRequest("The due date has passed; you can no longer edit your submission");
    }

    const [question] = await db.select().from(assignmentQuestions).where(eq(assignmentQuestions.id, data.questionId));
    if (!question) throw ApiError.notFound("Question not found");
    if (question.assignmentId !== submission.assignmentId) throw ApiError.badRequest("Question does not belong to this assignment");

    // MCQ correctness is deterministic (not AI-graded); descriptive answers are
    // left ungraded (marksAwarded null) until the teacher reviews them manually.
    let marksAwarded: number | null = null;
    if (question.type === "mcq") {
        const correctOptions = await db.select().from(assignmentOptions).where(
            and(eq(assignmentOptions.questionId, question.id), eq(assignmentOptions.isCorrect, true))
        );
        const correctIds = correctOptions.map(o => o.id).sort();
        const selectedIds = [...(data.options ?? [])].sort();
        const isCorrect = JSON.stringify(correctIds) === JSON.stringify(selectedIds);
        marksAwarded = isCorrect ? question.marks : 0;
    }

    const [existingAnswer] = await db.select().from(assignmentAnswers).where(
        and(eq(assignmentAnswers.submissionId, data.submissionId), eq(assignmentAnswers.questionId, data.questionId))
    );

    if (existingAnswer) {
        const [updated] = await db.update(assignmentAnswers)
            .set({
                options: data.options ?? [],
                textAnswer: data.textAnswer ?? null,
                marksAwarded,
                updatedAt: new Date(),
            })
            .where(eq(assignmentAnswers.id, existingAnswer.id))
            .returning();
        return updated;
    }

    const [created] = await db.insert(assignmentAnswers).values({
        submissionId: data.submissionId,
        questionId: data.questionId,
        options: data.options ?? [],
        textAnswer: data.textAnswer ?? null,
        marksAwarded,
    }).returning();

    return created;
};

// ── Run Assignment AI Evaluation in Background ───────────────────────────────
const runAssignmentAiEvaluation = async (submissionId: string) => {
    try {
        const submissionAnswersData = await db.select().from(assignmentAnswers).where(
            eq(assignmentAnswers.submissionId, submissionId)
        );

        const [submission] = await db.select().from(assignmentSubmissions).where(
            eq(assignmentSubmissions.id, submissionId)
        );
        if (!submission) return;

        const [assignment] = await db.select().from(assignments).where(
            eq(assignments.id, submission.assignmentId)
        );

        const textAnswersToEvaluate: TextAnswer[] = [];

        for (const answer of submissionAnswersData) {
            const [question] = await db.select().from(assignmentQuestions).where(
                eq(assignmentQuestions.id, answer.questionId)
            );
            if (!question) continue;

            if (question.type === "descriptive") {
                textAnswersToEvaluate.push({
                    answerId: answer.id,
                    questionId: question.id,
                    question: question.description,
                    modelAnswer: question.modelAnswer || "",
                    studentAnswer: answer.textAnswer ?? "",
                    maxMarks: question.marks,
                    rubric: (question as any).rubric || null,
                });
            }
        }

        if (textAnswersToEvaluate.length > 0) {
            for (const textAns of textAnswersToEvaluate) {
                const { marksAwarded, feedback } = await evaluateAnswer(textAns);

                await db.update(assignmentAnswers)
                    .set({
                        marksAwarded,
                        feedback,
                        updatedAt: new Date()
                    })
                    .where(eq(assignmentAnswers.id, textAns.answerId));
            }
        }

        // Recalculate total marks awarded
        const allAnswers = await db.select().from(assignmentAnswers).where(
            eq(assignmentAnswers.submissionId, submissionId)
        );
        const totalMarksAwarded = allAnswers.reduce((sum, a) => sum + (a.marksAwarded ?? 0), 0);

        await db.update(assignmentSubmissions)
            .set({
                status: "submitted",
                totalMarksAwarded,
                updatedAt: new Date()
            })
            .where(eq(assignmentSubmissions.id, submissionId));

    } catch (e) {
        console.error("Assignment background AI evaluation failed:", e);
        await db.update(assignmentSubmissions)
            .set({ status: "submitted", updatedAt: new Date() })
            .where(eq(assignmentSubmissions.id, submissionId));
    }
};

// ── Submit Assignment (finalize; grading of descriptive answers comes later) ─
const submitAssignment = async (submissionId: string, studentId: string) => {
    const [submission] = await db.select().from(assignmentSubmissions).where(eq(assignmentSubmissions.id, submissionId));
    if (!submission) throw ApiError.notFound("Submission not found");
    if (submission.studentId !== studentId) throw ApiError.forbidden("You are not authorized to submit this");
    if (submission.status === "graded") throw ApiError.badRequest("This assignment has already been graded");

    const [assignment] = await db.select().from(assignments).where(eq(assignments.id, submission.assignmentId));
    const now = new Date();
    const { dueDate } = assignment ? await getComputedAssignmentDates(assignment, studentId) : { dueDate: null };

    // Re-submitting an already-submitted assignment (editing an answer) is only
    // allowed up until the due date; the first submission is always allowed
    // (even late, tracked via isLate) so a student can't be locked out entirely.
    if (submission.status === "submitted" && dueDate && now > dueDate) {
        throw ApiError.badRequest("The due date has passed; you can no longer edit your submission");
    }

    const isLate = !!(dueDate && now > dueDate);

    // Check if assignment has descriptive questions
    const questionsData = await db.select().from(assignmentQuestions).where(
        eq(assignmentQuestions.assignmentId, submission.assignmentId)
    );
    const hasDescriptive = questionsData.some(q => q.type === "descriptive");

    const status = hasDescriptive ? "evaluating" : "submitted";

    const [updated] = await db.update(assignmentSubmissions)
        .set({ status, submittedAt: now, isLate, updatedAt: now })
        .where(eq(assignmentSubmissions.id, submissionId))
        .returning();

    if (hasDescriptive) {
        (async () => {
            await runAssignmentAiEvaluation(submissionId);
        })();
    }

    return updated;
};

// ── Get My Submission (student) ──────────────────────────────────────────────
const getMySubmission = async (assignmentId: string, studentId: string) => {
    const [submission] = await db.select().from(assignmentSubmissions).where(
        and(eq(assignmentSubmissions.assignmentId, assignmentId), eq(assignmentSubmissions.studentId, studentId))
    );
    if (!submission) return null;

    const answersData = await db.select().from(assignmentAnswers).where(eq(assignmentAnswers.submissionId, submission.id));
    return { ...submission, answers: answersData };
};

// ── List Submissions (teacher, grading queue) ────────────────────────────────
const getSubmissionsForAssignment = async (
    assignmentId: string,
    teacherId: string,
    options?: { search?: string | undefined; page?: number | undefined; limit?: number | undefined }
) => {
    const hasAccess = await PermissionService.teacher.canManageAssignment(teacherId, assignmentId);
    if (!hasAccess) throw ApiError.forbidden("You are not authorized to view this assignment");

    const conditions = [
        eq(assignmentSubmissions.assignmentId, assignmentId),
        isNull(assignmentSubmissions.deletedAt),
        inArray(assignmentSubmissions.status, ["submitted", "graded"]),
    ];
    if (options?.search) {
        conditions.push(or(ilike(users.name, `%${options.search}%`), ilike(users.email, `%${options.search}%`))!);
    }

    const baseQuery = () => db.select({
        id: assignmentSubmissions.id,
        studentId: users.id,
        studentName: users.name,
        studentEmail: users.email,
        avatarUrl: users.avatarUrl,
        status: assignmentSubmissions.status,
        submittedAt: assignmentSubmissions.submittedAt,
        isLate: assignmentSubmissions.isLate,
        totalMarksAwarded: assignmentSubmissions.totalMarksAwarded,
    })
        .from(assignmentSubmissions)
        .innerJoin(users, eq(assignmentSubmissions.studentId, users.id))
        .where(and(...conditions));

    // Paginated form (used by the dedicated Submissions page) — opted into by
    // passing `page`. Without it, returns the full unpaginated array as before
    // (used by the assignment detail page's Submissions tab).
    if (options?.page) {
        const page = options.page;
        const limit = options.limit ?? 10;
        const offset = (page - 1) * limit;

        const data = await baseQuery().orderBy(desc(assignmentSubmissions.submittedAt)).limit(limit).offset(offset);

        const [totalCount] = await db.select({ value: count() })
            .from(assignmentSubmissions)
            .innerJoin(users, eq(assignmentSubmissions.studentId, users.id))
            .where(and(...conditions));
        const total = Number(totalCount?.value) || 0;

        return { data, total, page, limit, hasMore: offset + data.length < total };
    }

    return await baseQuery();
};

// ── Get Submission By Id (teacher, full detail for grading) ──────────────────
const getSubmissionById = async (submissionId: string, teacherId: string) => {
    const [submission] = await db.select().from(assignmentSubmissions).where(eq(assignmentSubmissions.id, submissionId));
    if (!submission) throw ApiError.notFound("Submission not found");

    const hasAccess = await PermissionService.teacher.canManageAssignment(teacherId, submission.assignmentId);
    if (!hasAccess) throw ApiError.forbidden("You are not authorized to view this submission");

    const answersData = await db.select().from(assignmentAnswers).where(eq(assignmentAnswers.submissionId, submissionId));
    return { ...submission, answers: answersData };
};

// ── Grade Submission (teacher: marks + feedback per answer, then finalize) ──
const gradeSubmission = async (submissionId: string, data: GradeAssignmentSubmissionDto, teacherId: string) => {
    const [submission] = await db.select().from(assignmentSubmissions).where(eq(assignmentSubmissions.id, submissionId));
    if (!submission) throw ApiError.notFound("Submission not found");

    const hasAccess = await PermissionService.teacher.canManageAssignment(teacherId, submission.assignmentId);
    if (!hasAccess) throw ApiError.forbidden("You are not authorized to grade this submission");

    if (submission.status === "in_progress") throw ApiError.badRequest("Student has not submitted this assignment yet");

    return await db.transaction(async (tx) => {
        for (const graded of data.answers) {
            const [answerRow] = await tx.select().from(assignmentAnswers).where(
                and(eq(assignmentAnswers.id, graded.answerId), eq(assignmentAnswers.submissionId, submissionId))
            );
            if (!answerRow) throw ApiError.notFound(`Answer ${graded.answerId} not found for this submission`);

            const [question] = await tx.select().from(assignmentQuestions).where(eq(assignmentQuestions.id, answerRow.questionId));
            if (!question) throw ApiError.notFound("Question not found");
            if (graded.marksAwarded > question.marks) {
                throw ApiError.badRequest(`Marks awarded (${graded.marksAwarded}) cannot exceed this question's max marks (${question.marks})`);
            }

            await tx.update(assignmentAnswers)
                .set({ marksAwarded: graded.marksAwarded, feedback: graded.feedback ?? null, updatedAt: new Date() })
                .where(and(eq(assignmentAnswers.id, graded.answerId), eq(assignmentAnswers.submissionId, submissionId)));
        }

        const allAnswers = await tx.select().from(assignmentAnswers).where(eq(assignmentAnswers.submissionId, submissionId));
        const totalMarksAwarded = allAnswers.reduce((sum, a) => sum + (a.marksAwarded ?? 0), 0);

        const [graded] = await tx.update(assignmentSubmissions)
            .set({
                status: "graded",
                totalMarksAwarded,
                overallFeedback: data.overallFeedback ?? null,
                gradedBy: teacherId,
                gradedAt: new Date(),
                updatedAt: new Date(),
            })
            .where(eq(assignmentSubmissions.id, submissionId))
            .returning();

        return graded;
    });
};

export {
    createSeries,
    listMySeries,
    updateSeries,
    deleteSeries,
    createAssignment,
    extendAssignment,
    updateAssignment,
    deleteAssignment,
    listMyAssignments,
    getAssignmentById,
    getAssignmentForStudent,
    createQuestion,
    updateQuestion,
    deleteQuestion,
    getQuestionsForTeacher,
    getQuestionsForStudent,
    getMyAssignments,
    joinByCode,
    startAssignment,
    saveAnswer,
    submitAssignment,
    getMySubmission,
    getSubmissionsForAssignment,
    getSubmissionById,
    gradeSubmission,
};
