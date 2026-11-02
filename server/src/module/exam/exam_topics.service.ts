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
import type { Difficulty } from "../generation_agents/Types/inputExam.js";

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
                rubric: q.type === "descriptive" ? { categories: q.rubric.categories } : undefined,
            } as any,
            requester
        );
    }

    return { topic, added: verified.length, requested: input.count };
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
