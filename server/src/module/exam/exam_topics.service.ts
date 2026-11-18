import { and, eq, inArray } from "drizzle-orm";
import db from "../../common/db/index.js";
import { blocks, exams, questions, sections } from "../../common/db/schema.js";
import { ApiError } from "../../common/utils/ApiError.js";
import { PermissionService, type Requester } from "../../common/permissions/index.js";
import { createQuestion, recalculateExamTotalMarks } from "../questions/question.service.js";
import { generateSectionSubtopics } from "../generation_agents/agents/subtopics_agent.js";
import { generateTopicQuestions, type GenerateTopicQuestionsInput } from "../generation_agents/agents/generation_agent.js";
import { verifyAndRepairTopicQuestions } from "../generation_agents/topic_question_verification.js";
import { allocateSectionQuestions } from "../generation_agents/allocation.js";
import { assertQuota, recordUsage } from "../plans/quota.service.js";
import type { Difficulty, QuestionType } from "../generation_agents/Types/inputExam.js";
import type { QuestionBankDocument } from "../question_bank/question_bank.schema.js";
import { pickQuestionsFromPapers, sameQuestionText, type SubtopicPick } from "../question_bank/question_bank_picker.js";

const OPTION_LETTERS = ["A", "B", "C", "D"];
const MAX_QUESTIONS_PER_TOPIC = 15;
// How many existing questions are shown to the generator so it doesn't repeat them.
const EXISTING_QUESTIONS_SHOWN = 40;

export interface AddTopicInput {
    sectionId: string;
    blockId: string;
    topic: string;
    // What the teacher wants this topic to cover, in their own words. Optional.
    description?: string | undefined;
    count: number;
    difficulty?: Difficulty | undefined;
}

// Topics can only be changed while the exam is still a draft: once it is published students may already have
// answered, and removing questions would break their results.
const loadDraftExam = async (examId: string, requester: Requester) => {
    const [exam] = await db.select().from(exams).where(eq(exams.id, examId));
    if (!exam) throw ApiError.notFound("Exam not found");
    if (!(await PermissionService.canManageExam(requester, examId))) throw ApiError.forbidden("You are not authorized to edit this exam");
    if (exam.status === "PUBLISHED") throw ApiError.badRequest("Topics can only be changed while the exam is a draft");
    return exam;
};

/**
 * Plans subtopics for ONE new topic, writes its questions and adds them (tagged with the topic and subtopic) to an
 * existing section. Same agents and answer-key check the exam went through when it was first created; nothing else in
 * the exam is touched.
 */
export const addTopicToExam = async (examId: string, input: AddTopicInput, requester: Requester) => {
    await loadDraftExam(examId, requester);

    const topic = String(input.topic ?? "").trim();
    input = { ...input, count: Number(input.count) };
    if (!topic) throw ApiError.badRequest("Topic is required");
    const description = String(input.description ?? "").trim();
    if (!Number.isInteger(input.count) || input.count < 1 || input.count > MAX_QUESTIONS_PER_TOPIC) {
        throw ApiError.badRequest(`Number of questions must be between 1 and ${MAX_QUESTIONS_PER_TOPIC}`);
    }

    const [section] = await db.select().from(sections).where(and(eq(sections.id, input.sectionId), eq(sections.examId, examId)));
    if (!section) throw ApiError.notFound("Section not found");
    const [block] = await db.select().from(blocks).where(and(eq(blocks.id, input.blockId), eq(blocks.sectionId, section.id)));
    if (!block) throw ApiError.notFound("Question group not found in this section");

    const sectionQuestions = await db.select().from(questions).where(eq(questions.sectionId, section.id)).orderBy(questions.position);
    if (sectionQuestions.some((q) => (q.topic ?? "").toLowerCase() === topic.toLowerCase())) {
        throw ApiError.badRequest(`"${topic}" is already a topic in this section. Remove it first to regenerate it.`);
    }

    // Marks per question follow the questions already in this group, so the new ones match.
    const inBlock = sectionQuestions.filter((q) => q.blockId === block.id);
    const marks = inBlock[0]?.marks ?? (block.questionCount > 0 && block.totalMarks > 0 ? block.totalMarks / block.questionCount : 1);
    const questionType = block.questionType;

    // Refused before the AI plans anything if the plan can't cover the questions asked for.
    await assertQuota(requester.id, "question_generation", input.count);

    const planned = await generateSectionSubtopics(
        { name: section.title, subject: block.subject, question_count: input.count, question_type: questionType, marks, topics: [topic] },
        { globalInstructions: [], topicInstructions: description ? [{ topic, instructions: [description] }] : [], difficulty: input.difficulty }
    );
    const [allocated] = allocateSectionQuestions(planned.topics, input.count);
    const subtopics = (allocated?.subtopics ?? []).filter((s) => s.allocatedQuestions > 0);
    if (!allocated || subtopics.length === 0) throw ApiError.internal("Could not plan subtopics for this topic. Please try again.");

    const existing = sectionQuestions.slice(-EXISTING_QUESTIONS_SHOWN).map((q) => `- ${q.description.replace(/\s+/g, " ").slice(0, 160)}`);
    const generationInput: GenerateTopicQuestionsInput = {
        subject: block.subject,
        question_type: questionType,
        marks,
        difficulty: input.difficulty,
        topic,
        subtopics: subtopics.map((s) => ({ name: s.name, count: s.allocatedQuestions })),
        globalInstructions: [],
        topicInstructions: [
            ...(description ? [description] : []),
            ...(existing.length > 0 ? [`These questions are already in the exam. Do not repeat or closely copy any of them:\n${existing.join("\n")}`] : []),
        ],
    };
    const output = await generateTopicQuestions(generationInput);
    const verified = await verifyAndRepairTopicQuestions(generationInput, output.questions);
    if (verified.length === 0) throw ApiError.internal("No valid questions could be generated for this topic. Please try again.");

    for (const q of verified) {
        await createQuestion(
            {
                sectionId: section.id,
                blockId: block.id,
                type: q.type,
                description: q.question_text,
                marks,
                topic,
                subtopic: q.subtopic,
                contentBlocks: q.content_blocks,
                options: q.type === "mcq"
                    ? q.options.map((opt, i) => ({ value: opt.text, isCode: opt.isCode, isCorrect: OPTION_LETTERS[i] === q.correct_option }))
                    : undefined,
            } as any,
            requester
        );
    }

    await recordUsage(requester.id, "question_generation", verified.length);

    return { topic, added: verified.length, requested: input.count };
};

export interface AddPaperTopicsInput {
    sectionId: string;
    // MCQ or written. Only needed when the section has groups of both types; otherwise the section's own type is used.
    questionType?: QuestionType | undefined;
    // Subtopics of the exam's own papers (keys as the past-paper topic picker gives them) and how many of each.
    picks: SubtopicPick[];
}

// At most this many questions are added from the papers in one go.
const MAX_PAPER_QUESTIONS = 50;

// Every question in the exam: its text, where it is, its type and marks.
const examQuestionRows = async (examId: string) => {
    const examSectionIds = (await db.select({ id: sections.id }).from(sections).where(eq(sections.examId, examId))).map((s) => s.id);
    if (examSectionIds.length === 0) return [];
    return await db.select({ description: questions.description, sectionId: questions.sectionId, type: questions.type, marks: questions.marks })
        .from(questions)
        .where(inArray(questions.sectionId, examSectionIds))
        .orderBy(questions.position);
};

/**
 * The text of every question already in a draft exam the teacher can edit, in the form used to spot the same question
 * (sameQuestionText). The past-paper topic picker uses it to show only the questions that can still be added.
 */
export const examQuestionTexts = async (examId: string, requester: Requester): Promise<Set<string>> => {
    await loadDraftExam(examId, requester);
    return new Set((await examQuestionRows(examId)).map((q) => sameQuestionText(q.description)));
};

/**
 * Adds REAL questions from the past papers an exam was made from, for an exam built in the past-paper flow: the
 * subtopics picked, as many of each as asked for, shared out exactly as the past-paper picker does
 * (question_bank_picker.ts). Questions already in the exam are never added again. No AI is used. Each question is
 * tagged with its broad topic and subtopic, like the questions the exam started with, and goes into the section's group
 * for that broad topic (a new group when the section has none yet).
 */
export const addPaperTopicsToExam = async (
    examId: string,
    input: AddPaperTopicsInput,
    requester: Requester,
    loadDocuments: (documentIds: string[]) => Promise<QuestionBankDocument[]>
) => {
    const exam = await loadDraftExam(examId, requester);

    const picks = (Array.isArray(input.picks) ? input.picks : []).map((p) => ({
        documentId: String(p?.documentId ?? ""),
        subtopic: String(p?.subtopic ?? "").trim(),
        count: Number(p?.count),
    }));
    if (picks.length === 0) throw ApiError.badRequest("Choose at least one topic");
    if (picks.some((p) => !p.documentId || !p.subtopic || !Number.isInteger(p.count) || p.count < 1)) {
        throw ApiError.badRequest("Choose how many questions to take from each topic");
    }
    const requested = picks.reduce((n, p) => n + p.count, 0);
    if (requested > MAX_PAPER_QUESTIONS) throw ApiError.badRequest(`At most ${MAX_PAPER_QUESTIONS} questions can be added at once`);
    const documentIds = [...new Set(picks.map((p) => p.documentId))];
    if (documentIds.some((id) => !(exam.sourceDocumentIds ?? []).includes(id))) {
        throw ApiError.badRequest("Topics can only be taken from the papers this exam was made from");
    }

    const [section] = await db.select().from(sections).where(and(eq(sections.id, input.sectionId), eq(sections.examId, examId)));
    if (!section) throw ApiError.notFound("Section not found");
    const sectionBlocks = await db.select().from(blocks).where(eq(blocks.sectionId, section.id)).orderBy(blocks.position);

    // The section's own type, unless it has groups of both types: then the teacher chooses.
    const sectionTypes = [...new Set(sectionBlocks.map((b) => b.questionType))];
    const questionType: QuestionType | undefined = input.questionType === "mcq" || input.questionType === "descriptive"
        ? input.questionType
        : sectionTypes.length === 1 ? sectionTypes[0] : sectionTypes.length === 0 ? "mcq" : undefined;
    if (!questionType) throw ApiError.badRequest("Choose MCQ or written questions for this section");

    // Marks per question follow the questions of the same type already in this section (or else in the exam).
    const examQuestions = await examQuestionRows(examId);
    const sameType = examQuestions.filter((q) => q.type === questionType);
    const marks = (sameType.find((q) => q.sectionId === section.id) ?? sameType[0])?.marks ?? 1;
    // Every question already in the exam, so a paper question that is already there isn't picked again.
    const exclude = new Set(examQuestions.map((q) => sameQuestionText(q.description)));

    const documents = await loadDocuments(documentIds);
    const { groups, shortfalls } = await pickQuestionsFromPapers({ picks, questionType, marks, exclude }, documents);

    // The past-paper flow names each group after its broad topic, so a question joins the group of the same name and type.
    const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
    let nextPosition = sectionBlocks.reduce((max, b) => Math.max(max, b.position), -1) + 1;
    let added = 0;
    for (const group of groups) {
        if (group.questions.length === 0) continue;
        let block = sectionBlocks.find((b) => b.questionType === questionType && sameName(b.name, group.topic));
        if (!block) {
            const [created] = await db.insert(blocks).values({ sectionId: section.id, name: group.topic, subject: "", questionType, position: nextPosition++ }).returning();
            if (!created) throw ApiError.internal("Failed to create question group");
            sectionBlocks.push(created);
            block = created;
        }
        for (const q of group.questions) {
            await createQuestion(
                {
                    sectionId: section.id,
                    blockId: block.id,
                    type: q.type,
                    description: q.question_text,
                    marks,
                    topic: group.topic,
                    subtopic: q.topic,
                    contentBlocks: q.content_blocks,
                    options: q.type === "mcq"
                        ? (q.options ?? []).map((opt, i) => ({ value: opt, isCode: false, isCorrect: OPTION_LETTERS[i] === q.correct_option }))
                        : undefined,
                } as any,
                requester
            );
            added++;
        }
        await db.update(blocks)
            .set({ questionCount: block.questionCount + group.questions.length, totalMarks: block.totalMarks + marks * group.questions.length, updatedAt: new Date() })
            .where(eq(blocks.id, block.id));
    }
    if (added === 0) throw ApiError.badRequest("No more questions on these topics are left in the papers. Every one is already in the exam.");

    return { added, requested, shortfalls };
};

/** Deletes every question tagged with this topic in one section, and nothing else. */
export const removeTopicFromExam = async (examId: string, input: { sectionId: string; topic: string }, requester: Requester) => {
    await loadDraftExam(examId, requester);
    if (!input?.topic) throw ApiError.badRequest("Topic is required");

    const [section] = await db.select().from(sections).where(and(eq(sections.id, input.sectionId), eq(sections.examId, examId)));
    if (!section) throw ApiError.notFound("Section not found");

    const removed = await db.transaction(async (tx) => {
        const rows = await tx.select({ id: questions.id }).from(questions).where(and(eq(questions.sectionId, section.id), eq(questions.topic, input.topic)));
        if (rows.length === 0) return 0;
        await tx.delete(questions).where(inArray(questions.id, rows.map((r) => r.id)));
        await recalculateExamTotalMarks(examId, tx);
        return rows.length;
    });
    if (removed === 0) throw ApiError.notFound("No questions found for this topic");

    return { topic: input.topic, removed };
};
