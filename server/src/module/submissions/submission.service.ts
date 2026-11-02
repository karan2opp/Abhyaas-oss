import { eq, and, isNull, desc, or, ilike, gte, count, inArray } from "drizzle-orm";
import pLimit from "p-limit";
import db from "../../common/db/index.js";
import { submissions, examRegistrations, exams, answers, options, questions, sections, users } from "../../common/db/schema.js";
import { ApiError } from "../../common/utils/ApiError.js";
import { evaluateAnswer, type TextAnswer, type ResponseMode } from "../evalutaion/evalutaion.js";
import type { GradeExamSubmissionDto, EvaluateWithAiDto } from "./dto/submission.dto.js";
import { evaluationQueue } from "../../common/queue/queues.js";
import type { Requester } from "../../common/permissions/index.js";

// ── Whether a teacher has staff-level access to an exam (only its creator) ───
const hasStaffAccessToExam = async (requester: Requester, exam: typeof exams.$inferSelect): Promise<boolean> => {
    return requester.role === "teacher" && exam.createdBy === requester.id;
};

// ── Whether a requester may see a submission at all ───────────────────────────
// The student who owns it, or staff with access to its exam. Used by anything
// that exposes a submission indirectly (e.g. its evaluation job's state).
export const canAccessSubmission = async (submissionId: string, requester: Requester): Promise<boolean> => {
    const [submission] = await db.select().from(submissions).where(eq(submissions.id, submissionId));
    if (!submission) return false;
    if (submission.userId === requester.id) return true;

    const [exam] = await db.select().from(exams).where(eq(exams.id, submission.examId));
    if (!exam) return false;
    return hasStaffAccessToExam(requester, exam);
};

// ── Assert requester (the exam's creator) can grade/manage this exam's submissions ─
const assertCanManageExamSubmissions = async (requester: Requester, examId: string) => {
    const [exam] = await db.select().from(exams).where(eq(exams.id, examId));
    if (!exam) throw ApiError.notFound("Exam not found");
    if (!(await hasStaffAccessToExam(requester, exam))) throw ApiError.forbidden("You are not authorized to manage this exam");
    return exam;
};

// ── Run AI evaluation for a batch of descriptive answers and persist the results ─
// Writes evaluatedBy: "ai" — callers are responsible for excluding any answer
// that has already been manually graded by a teacher (evaluatedBy === "teacher"),
// so AI evaluation can never overwrite a manual grade.
const runAndPersistAiEvaluation = async (textAnswersToEvaluate: TextAnswer[], mode: ResponseMode): Promise<number> => {
    const limit = pLimit(3);
    const results = await Promise.all(textAnswersToEvaluate.map((answer) => limit(() => evaluateAnswer(answer))));

    for (let i = 0; i < textAnswersToEvaluate.length; i++) {
        const answer = textAnswersToEvaluate[i]!;
        const result = results[i]!;
        await db.update(answers)
            .set({
                isCorrect: result.marksAwarded === answer.maxMarks,
                marksAwarded: result.marksAwarded,
                feedback: result.feedback,
                evaluatedBy: "ai",
            })
            .where(eq(answers.id, answer.answerId));
    }

    return results.reduce((sum, r) => sum + (r.marksAwarded || 0), 0);
};

// ── Build the list of descriptive answers eligible for AI evaluation ───────────
// Skips any answer already graded by a teacher, so AI never overwrites a manual grade.
const buildTextAnswersForEvaluation = async (submissionId: string): Promise<TextAnswer[]> => {
    const submissionAnswers = await db.select().from(answers).where(eq(answers.submissionId, submissionId));

    const textAnswersToEvaluate: TextAnswer[] = [];
    for (const answer of submissionAnswers) {
        if (answer.evaluatedBy === "teacher") continue;
        const [question] = await db.select().from(questions).where(eq(questions.id, answer.questionId));
        if (!question || question.type !== "descriptive") continue;
        textAnswersToEvaluate.push({
            answerId: answer.id,
            questionId: question.id,
            question: question.description,
            modelAnswer: question.modelAnswer || "",
            studentAnswer: answer.textAnswer ?? "",
            maxMarks: question.marks,
            questionImages: question.images as any,
            contentBlocks: question.contentBlocks,
            rubric: question.rubric,
        });
    }
    return textAnswersToEvaluate;
};

// ── Evaluate a submission's descriptive answers (called by the BullMQ worker) ──
// Re-fetches answers from the DB, runs the multi-round AI evaluation, and marks
// the submission as submitted with the recomputed total score.
export const evaluateDescriptiveAnswers = async (submissionId: string, mode: string): Promise<void> => {
    const [submission] = await db.select().from(submissions).where(eq(submissions.id, submissionId));
    if (!submission) throw ApiError.notFound("Submission not found");

    const textAnswersToEvaluate = await buildTextAnswersForEvaluation(submissionId);

    if (textAnswersToEvaluate.length > 0) {
        const evalMode: ResponseMode = (mode === "detailed" || mode === "marks_and_feedback") ? "marks_and_feedback" : "marks_only";
        await runAndPersistAiEvaluation(textAnswersToEvaluate, evalMode);
    }

    const allAnswers = await db.select().from(answers).where(eq(answers.submissionId, submissionId));
    const totalScore = allAnswers.reduce((sum, a) => sum + (a.marksAwarded ?? 0), 0);

    await db.update(submissions)
        .set({ status: "submitted", score: totalScore, updatedAt: new Date() })
        .where(eq(submissions.id, submissionId));
};

// ── Shared: start (or resume) a submission for a resolved exam ─────────────────
const startSubmissionForExam = async (exam: typeof exams.$inferSelect, studentId: string) => {
    // check exam time is valid
    const now = new Date();
    if (exam.startTime && now < exam.startTime) throw ApiError.badRequest("Exam has not started yet");
    if (exam.endTime && now > exam.endTime) throw ApiError.badRequest("Exam has already ended");
    if (exam.publishTime && now < exam.publishTime) throw ApiError.badRequest("This exam is not published yet");

    // Create (or resume) the submission atomically. The partial unique index on
    // (examId, userId) WHERE deletedAt IS NULL guarantees a single active
    // submission even under concurrent requests.
    await db.insert(submissions).values({
        examId: exam.id,
        userId: studentId,
        status: "inprogress",
    }).onConflictDoNothing();

    const [submission] = await db.select().from(submissions).where(
        and(
            eq(submissions.examId, exam.id),
            eq(submissions.userId, studentId),
            isNull(submissions.deletedAt)
        )
    );

    if (!submission) throw ApiError.internal("Failed to join exam");

    if (submission.status !== "inprogress") {
        throw ApiError.conflict("You have already submitted this exam");
    }

    return { submission, exam };
};

// ── Join Exam (by code) ────────────────────────────────────────────────────────
const joinExam = async (joinCode: string, studentId: string) => {
    // Students often paste the code with spaces around it.
    joinCode = String(joinCode ?? "").trim();
    // find exam by join code
    const [exam] = await db.select().from(exams).where(eq(exams.joinCode, joinCode));
    if (!exam) throw ApiError.notFound("Invalid join code");

    return startSubmissionForExam(exam, studentId);
};

// ── Submit Exam ────────────────────────────────────────────────────────────────
const submitExam = async (submissionId: string, studentId: string, mode: string) => {
    // verify submission exists and belongs to student
    const [submission] = await db.select().from(submissions).where(
        and(
            eq(submissions.id, submissionId),
            eq(submissions.userId, studentId),
            isNull(submissions.deletedAt)
        )
    );
    if (!submission) throw ApiError.notFound("Submission not found");
    if (submission.status !== "inprogress") throw ApiError.badRequest("Exam has already been submitted");

    // fetch all answers for this submission
    const submissionAnswers = await db.select().from(answers).where(
        eq(answers.submissionId, submissionId)
    );

    let totalScore = 0;
    let hasDescriptive = false;

    // --- MCQ evaluation (sync, no AI) ---
    for (const answer of submissionAnswers) {
        const [question] = await db.select().from(questions).where(eq(questions.id, answer.questionId));
        if (!question) continue;

        if (question.type === "mcq") {
            const correctOptions = await db.select().from(options).where(
                and(eq(options.questionId, answer.questionId), eq(options.isCorrect, true))
            );

            const correctOptionIds = correctOptions.map(opt => opt.id);
            const selectedOptionIds = answer.options ?? [];

            const isCorrect =
                correctOptionIds.length === selectedOptionIds.length &&
                correctOptionIds.every(id => selectedOptionIds.includes(id));

            const marksAwarded = isCorrect ? question.marks : 0;
            totalScore += marksAwarded;

            await db.update(answers)
                .set({ isCorrect, marksAwarded, evaluatedBy: "ai" })
                .where(eq(answers.id, answer.id));

        } else if (question.type === "descriptive") {
            hasDescriptive = true;
        }
    }

    const queueEvaluation = hasDescriptive;

    // --- Set evaluating (AI grading queued) or submitted (nothing to grade) ---
    const [updated] = await db.update(submissions)
        .set({
            status: queueEvaluation ? "evaluating" : "submitted",
            score: totalScore,
            submittedAt: new Date(),
            updatedAt: new Date(),
        })
        .where(eq(submissions.id, submissionId))
        .returning();

    if (queueEvaluation) {
        await evaluationQueue.add("evaluate-submission", { submissionId, mode }, {
            attempts: 3,
            backoff: { type: "exponential", delay: 5000 },
        });
    }

    return updated;
};

// ── Manually Grade a Submission (the exam's creator) ────
// A teacher can always override an AI grade; AI (re-)evaluation must never
// overwrite a manual grade — see evaluateSubmissionWithAI below.
const gradeExamSubmission = async (submissionId: string, data: GradeExamSubmissionDto, requester: Requester) => {
    const [submission] = await db.select().from(submissions).where(eq(submissions.id, submissionId));
    if (!submission) throw ApiError.notFound("Submission not found");
    if (submission.status === "inprogress") throw ApiError.badRequest("Student has not submitted this exam yet");

    await assertCanManageExamSubmissions(requester, submission.examId);

    return await db.transaction(async (tx) => {
        for (const graded of data.answers) {
            const [answerRow] = await tx.select().from(answers).where(
                and(eq(answers.id, graded.answerId), eq(answers.submissionId, submissionId))
            );
            if (!answerRow) throw ApiError.notFound(`Answer ${graded.answerId} not found for this submission`);

            const [question] = await tx.select().from(questions).where(eq(questions.id, answerRow.questionId));
            if (!question) throw ApiError.notFound("Question not found");
            if (graded.marksAwarded > question.marks) {
                throw ApiError.badRequest(`Marks awarded (${graded.marksAwarded}) cannot exceed this question's max marks (${question.marks})`);
            }

            await tx.update(answers)
                .set({
                    marksAwarded: graded.marksAwarded,
                    feedback: graded.feedback ?? null,
                    isCorrect: graded.marksAwarded === question.marks,
                    evaluatedBy: "teacher",
                    updatedAt: new Date(),
                })
                .where(eq(answers.id, graded.answerId));
        }

        const allAnswers = await tx.select().from(answers).where(eq(answers.submissionId, submissionId));
        const totalScore = allAnswers.reduce((sum, a) => sum + (a.marksAwarded ?? 0), 0);

        const [updated] = await tx.update(submissions)
            .set({
                status: "submitted",
                score: totalScore,
                gradedBy: requester.id,
                gradedAt: new Date(),
                overallFeedback: data.overallFeedback ?? null,
                updatedAt: new Date(),
            })
            .where(eq(submissions.id, submissionId))
            .returning();

        return updated;
    });
};

// ── Trigger (or re-trigger) AI evaluation for a submission's descriptive answers ─
// Skips any answer already graded by a teacher — AI can never overwrite a manual grade.
const evaluateSubmissionWithAI = async (submissionId: string, data: EvaluateWithAiDto, requester: Requester) => {
    const [submission] = await db.select().from(submissions).where(eq(submissions.id, submissionId));
    if (!submission) throw ApiError.notFound("Submission not found");
    if (submission.status === "inprogress") throw ApiError.badRequest("Student has not submitted this exam yet");

    await assertCanManageExamSubmissions(requester, submission.examId);

    const textAnswersToEvaluate = await buildTextAnswersForEvaluation(submissionId);

    if (textAnswersToEvaluate.length === 0) {
        throw ApiError.badRequest("No descriptive answers are eligible for AI evaluation (they may already be manually graded)");
    }

    await runAndPersistAiEvaluation(textAnswersToEvaluate, data.mode);

    const allAnswers = await db.select().from(answers).where(eq(answers.submissionId, submissionId));
    const totalScore = allAnswers.reduce((sum, a) => sum + (a.marksAwarded ?? 0), 0);

    const [updated] = await db.update(submissions)
        .set({ status: "submitted", score: totalScore, updatedAt: new Date() })
        .where(eq(submissions.id, submissionId))
        .returning();

    return updated;
};

// ── Get Submission by ID (student sees own; the exam's creator sees any) ─
const getSubmissionById = async (submissionId: string, requester: Requester, mode: string = "detailed") => {
    let [result] = await db.select({
        submission: submissions,
        exam: exams
    }).from(submissions)
    .innerJoin(exams, eq(submissions.examId, exams.id))
    .where(and(eq(submissions.id, submissionId), isNull(submissions.deletedAt)));
    if (!result) throw ApiError.notFound("Submission not found");
    let submission = result.submission;

    const isOwner = submission.userId === requester.id;
    if (!isOwner && !(await hasStaffAccessToExam(requester, result.exam))) {
        throw ApiError.notFound("Submission not found");
    }

    if (submission.status === "inprogress") {
        const exam = result.exam;
        if (exam && exam.duration) {
            const endTime = new Date(submission.createdAt.getTime() + exam.duration * 60000);
            if (new Date() >= endTime) {
                try {
                    const updated = await submitExam(submissionId, submission.userId, mode);
                    if (updated) submission = updated;
                } catch (e) {
                    console.error("Auto-submit failed", e);
                }
            }
        }
    }

    // fetch answers with question and options details
    const submissionAnswers = await db.select().from(answers).where(
        eq(answers.submissionId, submissionId)
    );

    return { ...submission, answers: submissionAnswers };
};

// ── Get All Submissions for an Exam (the exam's creator) ─
const getSubmissionsByExam = async (examId: string, requester: Requester, mode: string = "simple") => {
    const exam = await assertCanManageExamSubmissions(requester, examId);

    const result = await db.select({
        submission: submissions,
        user: {
            id: users.id,
            name: users.name,
            email: users.email
        }
    }).from(submissions)
        .innerJoin(users, eq(submissions.userId, users.id))
        .where(
            and(eq(submissions.examId, examId), isNull(submissions.deletedAt))
        );

    const now = new Date();
    for (const row of result) {
        const sub = row.submission;
        if (sub && sub.status === "inprogress" && exam.duration) {
            const endTime = new Date(sub.createdAt.getTime() + exam.duration * 60000);
            if (now >= endTime) {
                try {
                    const updated = await submitExam(sub.id, sub.userId, mode);
                    if (updated) row.submission = updated;
                } catch (e) {
                    console.error("Auto-submit failed", e);
                }
            }
        }
    }

    return result;
};

// ── Soft Delete Submission ─────────────────────────────────────────────────────
const deleteSubmission = async (submissionId: string, studentId: string) => {
    const [submission] = await db.select().from(submissions).where(
        and(
            eq(submissions.id, submissionId),
            eq(submissions.userId, studentId),
            isNull(submissions.deletedAt)
        )
    );
    if (!submission) throw ApiError.notFound("Submission not found");

    await db.update(submissions)
        .set({ deletedAt: new Date() })
        .where(eq(submissions.id, submissionId));
};

// ── Get My Submissions ─────────────────────────────────────────────────────────
const getMySubmissions = async (studentId: string, mode: string = "simple", search?: string, days?: string, page: number = 1, limit: number = 10) => {
    const conditions = [
        eq(submissions.userId, studentId),
        isNull(submissions.deletedAt)
    ];

    if (search) {
        conditions.push(ilike(exams.title, `%${search}%`));
    }

    if (days && days !== "all") {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - parseInt(days));
        conditions.push(gte(submissions.createdAt, cutoffDate));
    }

    const offset = (page - 1) * limit;

    const data = await db.select({
        submission: submissions,
        exam: exams
    })
        .from(submissions)
        .innerJoin(exams, eq(submissions.examId, exams.id))
        .where(and(...conditions))
        .orderBy(desc(submissions.createdAt))
        .limit(limit)
        .offset(offset);

    const [totalCount] = await db.select({ value: count() })
        .from(submissions)
        .innerJoin(exams, eq(submissions.examId, exams.id))
        .where(and(...conditions));

    const total = Number(totalCount?.value) || 0;

    const now = new Date();
    for (const row of data) {
        if (row.submission.status === "inprogress" && row.exam.duration) {
            const endTime = new Date(row.submission.createdAt.getTime() + row.exam.duration * 60000);
            if (now >= endTime) {
                try {
                    const updated = await submitExam(row.submission.id, studentId, mode);
                    if (updated) row.submission = updated;
                } catch (e) {
                    console.error("Auto-submit failed for", row.submission.id, e);
                }
            }
        }
    }

    return {
        data,
        total,
        page,
        limit,
        hasMore: offset + data.length < total
    };
};

// ── Get Exam For Submission ────────────────────────────────────────────────────
const getExamForSubmission = async (submissionId: string, requester: Requester) => {
    let [result] = await db.select({
        submission: submissions,
        exam: exams
    }).from(submissions)
    .innerJoin(exams, eq(submissions.examId, exams.id))
    .where(and(eq(submissions.id, submissionId), isNull(submissions.deletedAt)));
    if (!result) throw ApiError.notFound("Submission not found");
    const { submission, exam } = result;

    const isOwner = submission.userId === requester.id;
    if (!isOwner && !(await hasStaffAccessToExam(requester, exam))) {
        throw ApiError.notFound("Submission not found");
    }

    const examSections = await db.select().from(sections).where(eq(sections.examId, exam.id));

    // Hide the answer key only from the student actually sitting the exam.
    // Staff (checked above) always see the full question, and the student
    // themselves sees it once they've submitted and are reviewing results.
    const hideAnswerKey = isOwner && submission.status === "inprogress";

    const sectionsWithQuestions = await Promise.all(examSections.map(async (section) => {
        const sectionQuestions = await db.select().from(questions).where(eq(questions.sectionId, section.id)).orderBy(questions.position);

        const questionsWithOptions = await Promise.all(sectionQuestions.map(async (question) => {
            const questionOptions = await (hideAnswerKey
                ? db.select({
                    id: options.id,
                    questionId: options.questionId,
                    value: options.value
                }).from(options).where(eq(options.questionId, question.id))
                : db.select().from(options).where(eq(options.questionId, question.id))
            );

            // options.isCorrect is stripped for MCQs above; rubric and
            // modelAnswer are the descriptive-question equivalent — rubric
            // key_points spell out exactly what the grader looks for — so
            // they have to come off the question for the same reason.
            if (hideAnswerKey) {
                const { rubric, modelAnswer, ...questionWithoutAnswerKey } = question;
                return { ...questionWithoutAnswerKey, options: questionOptions };
            }

            return { ...question, options: questionOptions };
        }));

        return { ...section, questions: questionsWithOptions };
    }));

    return { ...exam, sections: sectionsWithQuestions };
};
const verifyJoinCode = async (joinCode: string, studentId: string) => {
    joinCode = String(joinCode ?? "").trim();
    const [exam] = await db.select({
        id: exams.id,
        title: exams.title,
        startTime: exams.startTime,
        endTime: exams.endTime,
        duration: exams.duration,
        publishTime: exams.publishTime,
    }).from(exams).where(eq(exams.joinCode, joinCode));

    if (!exam) throw ApiError.notFound("Invalid join code");

    // We can also check if the exam has already ended or not published yet
    const now = new Date();
    if (exam.publishTime && now < exam.publishTime) throw ApiError.badRequest("This exam is not published yet");
    if (exam.endTime && now > exam.endTime) throw ApiError.badRequest("Exam has already ended");

    // Check if user already submitted
    const [existing] = await db.select().from(submissions).where(
        and(
            eq(submissions.examId, exam.id),
            eq(submissions.userId, studentId),
            isNull(submissions.deletedAt)
        )
    );

    if (existing && existing.status !== "inprogress") {
        throw ApiError.conflict("You have already submitted this exam");
    }

    // An exam that hasn't started yet is remembered for this student, so it appears on their dashboard with its
    // countdown and they don't have to enter the code again.
    if (!existing && exam.startTime && now < exam.startTime) {
        await db.insert(examRegistrations).values({ examId: exam.id, userId: studentId }).onConflictDoNothing();
    }

    return exam;
};

// ── Upcoming exams the student has entered the code for ───────────────────────
// Exams that haven't ended and that the student hasn't started yet. Once they start (a submission exists) the exam
// moves to "My Exams" and drops out of this list.
const getUpcomingExams = async (studentId: string) => {
    const now = new Date();
    const rows = await db.select({
        id: exams.id,
        title: exams.title,
        startTime: exams.startTime,
        endTime: exams.endTime,
        duration: exams.duration,
        publishTime: exams.publishTime,
        joinCode: exams.joinCode,
        registeredAt: examRegistrations.createdAt,
    })
        .from(examRegistrations)
        .innerJoin(exams, eq(examRegistrations.examId, exams.id))
        .where(eq(examRegistrations.userId, studentId))
        .orderBy(exams.startTime);
    if (rows.length === 0) return [];

    const started = await db.select({ examId: submissions.examId }).from(submissions).where(
        and(
            eq(submissions.userId, studentId),
            inArray(submissions.examId, rows.map((r) => r.id)),
            isNull(submissions.deletedAt)
        )
    );
    const startedIds = new Set(started.map((s) => s.examId));

    return rows.filter((r) => !startedIds.has(r.id) && (!r.endTime || now <= r.endTime) && (!r.publishTime || now >= r.publishTime));
};

// ── Get Exam Leaderboard ─────────────────────────────────────────────────────────
const getExamLeaderboard = async (examId: string, requester: Requester) => {
    const [exam] = await db.select().from(exams).where(eq(exams.id, examId));
    if (!exam) throw ApiError.notFound("Exam not found");

    if (requester.role === "student") {
        const [sub] = await db.select().from(submissions).where(
            and(eq(submissions.examId, examId), eq(submissions.userId, requester.id), isNull(submissions.deletedAt))
        );
        if (!sub) throw ApiError.forbidden("You must participate in the exam to view the leaderboard.");
    } else if (!(await hasStaffAccessToExam(requester, exam))) {
        throw ApiError.forbidden("You do not have permission to view this leaderboard.");
    }

    const result = await db.select({
        id: submissions.id,
        score: submissions.score,
        submittedAt: submissions.submittedAt,
        user: {
            id: users.id,
            name: users.name,
            email: users.email
        }
    })
    .from(submissions)
    .innerJoin(users, eq(submissions.userId, users.id))
    .where(
        and(
            eq(submissions.examId, examId),
            eq(submissions.status, "submitted"),
            isNull(submissions.deletedAt)
        )
    )
    .orderBy(desc(submissions.score), submissions.submittedAt);

    return result;
};

export { joinExam, submitExam, gradeExamSubmission, evaluateSubmissionWithAI, getSubmissionById, getSubmissionsByExam, deleteSubmission, getMySubmissions, getUpcomingExams, getExamForSubmission, verifyJoinCode, getExamLeaderboard };