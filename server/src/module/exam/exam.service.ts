import { eq, ne, and, count, inArray, avg, desc, ilike, gte, or, isNull, lte, sql } from "drizzle-orm";
import db from "../../common/db/index.js";
import { exams, sections, questions, options, blocks } from "../../common/db/schema.js";
import { submissions } from "../submissions/submission.schema.js";
import { ApiError } from "../../common/utils/ApiError.js";
import type { CreateExamDto, UpdateExamDto } from "./dto/exam.dto.js";
import { PermissionService, type Requester } from "../../common/permissions/index.js";
import { generateJoinCode } from "../../common/utils/joinCode.js";














// ── Assert requester can manage a specific existing exam ───────────────────────
const assertExamAccess = async (requester: Requester, examId: string) => {
    const [exam] = await db.select().from(exams).where(eq(exams.id, examId));
    if (!exam) throw ApiError.notFound("Exam not found");

    const hasAccess = await PermissionService.canManageExam(requester, examId);
    if (!hasAccess) throw ApiError.forbidden("You are not authorized to manage this exam");

    return exam;
};

// ── Create Exam ────────────────────────────────────────────────────────────────
const createExam = async (data: CreateExamDto, requester: Requester) => {
    let joinCode = generateJoinCode();

    // ensure join code is unique
    let existing = await db.select().from(exams).where(eq(exams.joinCode, joinCode));
    while (existing.length > 0) {
        joinCode = generateJoinCode();
        existing = await db.select().from(exams).where(eq(exams.joinCode, joinCode));
    }

    // Calculate duration automatically if not provided or if we want to override
    let calculatedDuration = data.duration;
    if (data.type === "SCHEDULED" && data.startTime && data.endTime) {
        calculatedDuration = Math.round((new Date(data.endTime).getTime() - new Date(data.startTime).getTime()) / 60000);
    }

    if (data.publishTime) {
        if (data.startTime && new Date(data.publishTime) >= new Date(data.startTime)) {
            throw ApiError.badRequest("Publish date and time must be before the start date and time of the exam");
        }
    }

    const [exam] = await db.insert(exams).values({
        ...data,
        totalMarks: data.totalMarks ?? 0,
        duration: calculatedDuration || 60, // fallback to 60 if somehow null
        joinCode,
        createdBy: requester.id,
    }).returning();

    if (!exam) throw ApiError.internal("Failed to create exam");
    return exam;
};

// ── Save Generated Exam ────────────────────────────────────────────────────────
const saveGeneratedExam = async (data: any, requester: Requester) => {
    return await db.transaction(async (tx) => {
        let calculatedTotalMarks = 0;
        for (const secData of data.sections || []) {
            if (Array.isArray(secData.blocks) && secData.blocks.length > 0) {
                for (const blockData of secData.blocks) {
                    for (const qData of blockData.questions || []) {
                        calculatedTotalMarks += Number(qData.marks) || 0;
                    }
                }
            } else {
                for (const qData of secData.questions || []) {
                    calculatedTotalMarks += Number(qData.marks) || 0;
                }
            }
        }

        let examId = data.examId;
        let exam;

        if (examId) {
            // Find existing exam and verify ownership/management permissions
            const [existingExam] = await tx.select().from(exams).where(eq(exams.id, examId));
            if (!existingExam) throw ApiError.notFound("Exam not found");

            const hasAccess = await PermissionService.canManageExam(requester, examId);
            if (!hasAccess) throw ApiError.forbidden("You are not authorized to edit this exam");

            // Update totalMarks (and honor status so AI-generated exams can publish)
            const [updatedExam] = await tx.update(exams)
                .set({
                    totalMarks: calculatedTotalMarks,
                    status: data.status || existingExam.status,
                    updatedAt: new Date()
                })
                .where(eq(exams.id, examId))
                .returning();
            exam = updatedExam;
        } else {
            let joinCode = generateJoinCode();
            let existing = await db.select().from(exams).where(eq(exams.joinCode, joinCode));
            while (existing.length > 0) {
                joinCode = generateJoinCode();
                existing = await db.select().from(exams).where(eq(exams.joinCode, joinCode));
            }

            // Create Exam
            const [newExam] = await tx.insert(exams).values({
                title: data.title,
                type: data.examType === "flexible" ? "ON_DEMAND" : "SCHEDULED",
                duration: data.duration,
                startTime: data.windowStart ? new Date(data.windowStart) : null,
                endTime: data.windowEnd ? new Date(data.windowEnd) : null,
                totalMarks: calculatedTotalMarks,
                instructions: [],
                joinCode,
                createdBy: requester.id,
                status: data.status || "DRAFT",
            }).returning();
            exam = newExam;
        }

        if (!exam) throw ApiError.internal("Failed to save exam");

        // Create Sections, Blocks, and Questions
        for (const secData of data.sections || []) {
            let sectionIdToUse = secData.targetSectionId || secData.target_section_id || secData.sectionId;

            if (!sectionIdToUse) {
                const secTitle = secData.title || secData.section_name || secData.name || "Section A";
                const [section] = await tx.insert(sections).values({
                    examId: exam.id,
                    title: secTitle,
                }).returning();

                if (!section) throw ApiError.internal("Failed to create section");
                sectionIdToUse = section.id;
            } else {
                // Validate that the target section belongs to the exam being saved.
                const [targetSection] = await tx.select().from(sections).where(eq(sections.id, sectionIdToUse));
                if (!targetSection) throw ApiError.notFound("Target section not found");
                if (targetSection.examId !== exam.id) {
                    throw ApiError.badRequest("Target section does not belong to this exam");
                }
            }

            // Position is scoped per SECTION (spanning every block in it —
            // matches how the UI numbers "Q1, Q2, ..." per section, and how
            // the Question Review Agent resolves "question N"), so this one
            // counter carries across every block/question inserted below,
            // regardless of which block they land in. Starts after whatever
            // already exists when appending to an existing section (0 for a
            // brand-new one).
            let nextPosition = 0;
            {
                const maxRows = await tx
                    .select({ maxPosition: sql<number | null>`max(${questions.position})` })
                    .from(questions)
                    .where(eq(questions.sectionId, sectionIdToUse));
                // An aggregate with no GROUP BY always returns exactly one
                // row, even over an empty set — the ?. is only for the type
                // checker (this codebase's strict noUncheckedIndexedAccess).
                const maxPosition = maxRows[0]?.maxPosition;
                if (maxPosition !== null && maxPosition !== undefined) nextPosition = maxPosition + 1;
            }

            const blockList = Array.isArray(secData.blocks) && secData.blocks.length > 0 ? secData.blocks : null;

            if (blockList) {
                for (const [blockIdx, blockData] of blockList.entries()) {
                    const [block] = await tx.insert(blocks).values({
                        sectionId: sectionIdToUse,
                        name: blockData.name || "Block",
                        subject: blockData.subject || "",
                        questionType: blockData.question_type || "mcq",
                        questionCount: blockData.question_count || (Array.isArray(blockData.questions) ? blockData.questions.length : 0),
                        totalMarks: blockData.total_marks || 0,
                        instructions: Array.isArray(blockData.instructions) ? blockData.instructions : [],
                        position: blockIdx,
                    }).returning();

                    if (!block) throw ApiError.internal("Failed to create block");

                    for (const qData of blockData.questions || []) {
                        const [question] = await tx.insert(questions).values({
                            sectionId: sectionIdToUse,
                            blockId: block.id,
                            type: qData.type,
                            description: qData.description,
                            marks: qData.marks,
                            position: nextPosition++,
                            rubric: qData.rubric || null,
                            topic: qData.topic ?? null,
                            subtopic: qData.subtopic ?? null,
                            contentBlocks: qData.contentBlocks || qData.content_blocks || [],
                        }).returning();

                        if (!question) throw ApiError.internal("Failed to create question");

                        if (qData.type === "mcq" && qData.options) {
                            await tx.insert(options).values(
                                qData.options.map((opt: any) => ({
                                    questionId: question.id,
                                    value: opt.value,
                                    isCorrect: opt.isCorrect,
                                    isCode: opt.isCode ?? opt.is_code ?? false,
                                }))
                            );
                        }
                    }
                }
            } else {
                // Legacy shape: questions directly under the section (no blocks)
                for (const qData of secData.questions || []) {
                    const [question] = await tx.insert(questions).values({
                        sectionId: sectionIdToUse,
                        type: qData.type,
                        description: qData.description,
                        marks: qData.marks,
                        position: nextPosition++,
                        rubric: qData.rubric || null,
                        topic: qData.topic ?? null,
                        subtopic: qData.subtopic ?? null,
                        contentBlocks: qData.contentBlocks || qData.content_blocks || [],
                    }).returning();

                    if (!question) throw ApiError.internal("Failed to create question");

                    if (qData.type === "mcq" && qData.options) {
                        await tx.insert(options).values(
                            qData.options.map((opt: any) => ({
                                questionId: question.id,
                                value: opt.value,
                                isCorrect: opt.isCorrect,
                                isCode: opt.isCode ?? opt.is_code ?? false,
                            }))
                        );
                    }
                }
            }
        }

        // Recalculate grand total marks across all sections in this exam
        const allExamQuestions = await tx.select({ marks: questions.marks })
            .from(questions)
            .innerJoin(sections, eq(questions.sectionId, sections.id))
            .where(eq(sections.examId, exam.id));

        const grandTotalMarks = allExamQuestions.reduce((acc, q) => acc + (Number(q.marks) || 0), 0);

        const [savedExam] = await tx.update(exams)
            .set({ totalMarks: grandTotalMarks, updatedAt: new Date() })
            .where(eq(exams.id, exam.id))
            .returning();

        return savedExam ?? exam;
    });
};

// ── Get All Exams (teacher sees only their own) ────────────────────────────────
const getExams = async (teacherId: string, search?: string, days?: string, page: number = 1, limit: number = 10, status?: string) => {
    const baseConditions = [eq(exams.createdBy, teacherId), ne(exams.status, "UNSAVED")];

    if (search) {
        baseConditions.push(ilike(exams.title, `%${search}%`));
    }

    if (days && days !== "all") {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - parseInt(days));
        // Use createdAt for filtering newly created exams
        baseConditions.push(gte(exams.createdAt, cutoffDate));
    }

    // Counts for the status filter pills (independent of the current page)
    const [allRow] = await db.select({ value: count() }).from(exams).where(and(...baseConditions));
    const [pubRow] = await db.select({ value: count() }).from(exams).where(and(...baseConditions, eq(exams.status, "PUBLISHED")));
    const [draftRow] = await db.select({ value: count() }).from(exams).where(and(...baseConditions, eq(exams.status, "DRAFT")));

    const conditions = [...baseConditions];
    if (status === "published") conditions.push(eq(exams.status, "PUBLISHED"));
    if (status === "draft") conditions.push(eq(exams.status, "DRAFT"));

    const offset = (page - 1) * limit;

    const data = await db.select().from(exams)
        .where(and(...conditions))
        .orderBy(desc(exams.createdAt))
        .limit(limit)
        .offset(offset);

    const [totalCount] = await db.select({ value: count() }).from(exams)
        .where(and(...conditions));
    const total = Number(totalCount?.value) || 0;

    return {
        data,
        total,
        page,
        limit,
        hasMore: offset + data.length < total,
        counts: {
            all: Number(allRow?.value) || 0,
            published: Number(pubRow?.value) || 0,
            draft: Number(draftRow?.value) || 0,
        }
    };
};

// ── Get Single Exam ────────────────────────────────────────────────────────────
const getExamById = async (examId: string, requester: Requester) => {
    return await assertExamAccess(requester, examId);
};

// ── Update Exam ────────────────────────────────────────────────────────────────
const updateExam = async (examId: string, data: UpdateExamDto, requester: Requester) => {
    const existing = await assertExamAccess(requester, examId);

    // Calculate new duration if start/end times change
    let calculatedDuration = data.duration;
    const finalType = data.type !== undefined ? data.type : existing.type;
    const finalStartTime = data.startTime !== undefined ? data.startTime : existing.startTime;
    const finalEndTime = data.endTime !== undefined ? data.endTime : existing.endTime;

    if (finalType === "SCHEDULED" && finalStartTime && finalEndTime) {
        calculatedDuration = Math.round((new Date(finalEndTime).getTime() - new Date(finalStartTime).getTime()) / 60000);
    }

    if (data.publishTime !== undefined && data.publishTime !== null) {
        if (finalStartTime && new Date(data.publishTime) >= new Date(finalStartTime)) {
            throw ApiError.badRequest("Publish date and time must be before the start date and time of the exam");
        }
    }

    const [updated] = await db.update(exams)
        .set({
            ...data,
            duration: calculatedDuration !== undefined ? calculatedDuration : existing.duration,
            updatedAt: new Date()
        })
        .where(eq(exams.id, examId))
        .returning();

    return updated;
};

// ── Delete Exam ────────────────────────────────────────────────────────────────
const deleteExam = async (examId: string, requester: Requester) => {
    await assertExamAccess(requester, examId);
    await db.delete(exams).where(eq(exams.id, examId));
};

// ── Get Overview Stats ─────────────────────────────────────────────────────────
const getOverviewStats = async (teacherId: string) => {
    const [examsCount] = await db.select({ value: count() }).from(exams).where(and(eq(exams.createdBy, teacherId), ne(exams.status, "UNSAVED")));

    const recentExams = await db.select().from(exams)
        .where(and(eq(exams.createdBy, teacherId), ne(exams.status, "UNSAVED")))
        .orderBy(desc(exams.createdAt))
        .limit(5);

    const teacherExams = await db.select({ id: exams.id }).from(exams).where(eq(exams.createdBy, teacherId));
    const examIds = teacherExams.map(e => e.id);

    let totalStudents = 0;
    let totalSubmissions = 0;
    let studentsOnline = 0;
    let pendingEvaluations = 0;
    let averageScore = 0;

    if (examIds.length > 0) {
        const [submissionsCount] = await db.select({ value: count() }).from(submissions).where(inArray(submissions.examId, examIds));
        totalSubmissions = Number(submissionsCount?.value) || 0;

        const uniqueStudents = await db.selectDistinct({ userId: submissions.userId })
            .from(submissions)
            .where(and(
                inArray(submissions.examId, examIds),
                eq(submissions.status, "submitted")
            ));
        totalStudents = uniqueStudents.length;

        // Students currently attempting an exam (in-progress submission)
        const onlineStudents = await db.selectDistinct({ userId: submissions.userId })
            .from(submissions)
            .where(and(
                inArray(submissions.examId, examIds),
                eq(submissions.status, "inprogress")
            ));
        studentsOnline = onlineStudents.length;

        const [evaluatingCount] = await db.select({ value: count() }).from(submissions)
            .where(and(
                inArray(submissions.examId, examIds),
                eq(submissions.status, "evaluating")
            ));
        pendingEvaluations = Number(evaluatingCount?.value) || 0;

        const [avgResult] = await db.select({ value: avg(submissions.score) })
            .from(submissions)
            .where(and(inArray(submissions.examId, examIds), eq(submissions.status, "submitted")));

        averageScore = avgResult?.value ? Math.round(Number(avgResult.value)) : 0;
    }

    return {
        totalExams: Number(examsCount?.value) || 0,
        totalStudents,
        totalSubmissions,
        studentsOnline,
        pendingEvaluations,
        averageScore,
        recentExams
    };
};

// ── Get My Exams (student: every exam they joined with a code) ───────────────
const getMyExams = async (studentId: string, search?: string, category?: string, page: number = 1, limit: number = 10) => {
    const joined = await db.selectDistinct({ examId: submissions.examId }).from(submissions).where(
        and(eq(submissions.userId, studentId), isNull(submissions.deletedAt))
    );
    const joinedExamIds = joined.map(j => j.examId);
    if (joinedExamIds.length === 0) return { data: [], total: 0, page, limit, hasMore: false, counts: { upcoming: 0, inprogress: 0, closed: 0 } };

    const conditions = [
        inArray(exams.id, joinedExamIds),
        eq(exams.status, "PUBLISHED"),
        or(isNull(exams.publishTime), lte(exams.publishTime, new Date()))
    ];
    if (search) conditions.push(ilike(exams.title, `%${search}%`));

    const allExams = await db.select().from(exams).where(and(...conditions)).orderBy(desc(exams.createdAt));

    // Attach the student's submission to each exam so the UI can show status
    const examIds = allExams.map(e => e.id);
    const subMap: Record<string, any> = {};
    if (examIds.length > 0) {
        const subs = await db.select().from(submissions).where(
            and(inArray(submissions.examId, examIds), eq(submissions.userId, studentId))
        );
        subs.forEach(s => { subMap[s.examId] = s; });
    }

    const now = new Date();
    const withMeta = allExams.map(e => {
        const sub = subMap[e.id] || null;
        const subStatus = sub?.status;
        let cat: "upcoming" | "inprogress" | "closed";
        if (subStatus === "inprogress") cat = "inprogress";
        else if (subStatus === "submitted" || subStatus === "evaluating") cat = "closed";
        else if (e.type === "SCHEDULED") {
            if (e.startTime && now < new Date(e.startTime)) cat = "upcoming";
            else if (e.endTime && now > new Date(e.endTime)) cat = "closed";
            else cat = "inprogress";
        } else {
            cat = "inprogress"; // ON_DEMAND is available now
        }
        return { ...e, mySubmission: sub, category: cat };
    });

    const counts = {
        upcoming: withMeta.filter(x => x.category === "upcoming").length,
        inprogress: withMeta.filter(x => x.category === "inprogress").length,
        closed: withMeta.filter(x => x.category === "closed").length,
    };

    const filtered = category && category !== "all" ? withMeta.filter(x => x.category === category) : withMeta;
    const total = filtered.length;
    const offset = (page - 1) * limit;
    const data = filtered.slice(offset, offset + limit);

    return {
        data,
        total,
        page,
        limit,
        hasMore: offset + data.length < total,
        counts
    };
};












export { createExam, getExams, getExamById, updateExam, deleteExam, getOverviewStats, saveGeneratedExam, getMyExams };