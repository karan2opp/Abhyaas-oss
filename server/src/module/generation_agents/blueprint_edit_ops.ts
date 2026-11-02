import type { ExamBlueprintSection, AllocatedTopic, AllocatedSubtopic } from "./Types/outputSubtopics.js";
import { distributeQuestionsAtLeastOne, distributeQuestionsProportionally } from "./allocation.js";
import { generateSectionSubtopics } from "./agents/subtopics_agent.js";
import type { QuestionType, Difficulty, EducationLevel } from "./Types/inputExam.js";
import type {
    SetSubtopicCountArgs,
    SetTopicCountArgs,
    AddSubtopicArgs,
    DeleteSubtopicArgs,
    AddTopicArgs,
    DeleteTopicArgs,
    IncreaseTotalQuestionCountArgs,
} from "./Types/outputBlueprintReview.js";

// One section's settings from the teacher's exam form: what a newly added
// topic's subtopics are generated from, and the question count the teacher set.
export interface SectionContext {
    question_type: QuestionType;
    marks: number;
    difficulty?: Difficulty | undefined;
    educationLevel?: EducationLevel | undefined;
    globalInstructions: string[];
    examGoal?: string | undefined;
    targetQuestionCount: number;
}

export interface EditResult {
    section: ExamBlueprintSection;
    changeLog: string[];
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

export const sectionTotal = (section: ExamBlueprintSection): number =>
    section.topics.reduce((sum, t) => sum + t.allocatedQuestions, 0);

const findTopic = (section: ExamBlueprintSection, topicName: string): AllocatedTopic => {
    const t = section.topics.find((t) => t.topic === topicName);
    if (!t) throw new Error(`Topic "${topicName}" not found in this section.`);
    return t;
};

const findSubtopic = (topic: AllocatedTopic, subtopicName: string): AllocatedSubtopic => {
    const s = topic.subtopics.find((s) => s.name === subtopicName);
    if (!s) throw new Error(`Subtopic "${subtopicName}" not found under topic "${topic.topic}".`);
    return s;
};

// Subtopic counts are the source of truth. Topic totals and all weights are
// derived from them after every edit, so a later proportional rescale
// (rescaleSection) keeps the proportions the teacher actually set.
function syncFromCounts(section: ExamBlueprintSection): ExamBlueprintSection {
    const topics = section.topics.map((t) => {
        const total = t.subtopics.reduce((sum, s) => sum + s.allocatedQuestions, 0);
        return {
            ...t,
            allocatedQuestions: total,
            subtopics: t.subtopics.map((s) => ({ ...s, weight: total > 0 ? round3(s.allocatedQuestions / total) : 0 })),
        };
    });
    const total = topics.reduce((sum, t) => sum + t.allocatedQuestions, 0);
    return { ...section, topics: topics.map((t) => ({ ...t, weight: total > 0 ? round3(t.allocatedQuestions / total) : 0 })) };
}

/** Subtopics in `before` that are missing from `after`, labelled like `"Closures" (Functions)`. */
function droppedSubtopics(before: ExamBlueprintSection, after: ExamBlueprintSection): string[] {
    const kept = new Set(after.topics.flatMap((t) => t.subtopics.map((s) => `${t.topic}\u0000${s.name}`)));
    return before.topics.flatMap((t) =>
        t.subtopics.filter((s) => !kept.has(`${t.topic}\u0000${s.name}`)).map((s) => `"${s.name}" (${t.topic})`)
    );
}

function logDropped(before: ExamBlueprintSection, after: ExamBlueprintSection, changeLog: string[]) {
    const dropped = droppedSubtopics(before, after);
    if (dropped.length > 0) changeLog.push(`There weren't enough questions for every subtopic, so these were removed: ${dropped.join(", ")}.`);
}

// A topic left with no subtopics is removed with it; the section's very last
// subtopic can't be removed, because a section needs at least one.
function removeSubtopic(section: ExamBlueprintSection, topicName: string, subtopicName: string, changeLog: string[]): ExamBlueprintSection {
    const remaining = findTopic(section, topicName).subtopics.filter((s) => s.name !== subtopicName);
    if (remaining.length > 0) {
        changeLog.push(`Removed "${subtopicName}" from "${topicName}".`);
        return { ...section, topics: section.topics.map((t) => (t.topic === topicName ? { ...t, subtopics: remaining } : t)) };
    }
    if (section.topics.length === 1) {
        throw new Error(`"${subtopicName}" is the only subtopic left in this section, so it can't be removed.`);
    }
    changeLog.push(`Removed "${subtopicName}". It was the last subtopic of "${topicName}", so that topic was removed too.`);
    return { ...section, topics: section.topics.filter((t) => t.topic !== topicName) };
}

/** Rescales a section to `newTotal` questions in its current proportions — the same allocation the blueprint was built with. */
export function rescaleSection(section: ExamBlueprintSection, newTotal: number): EditResult {
    const topics = distributeQuestionsProportionally(section.topics, newTotal).map((t) => ({
        ...t,
        subtopics: distributeQuestionsProportionally(t.subtopics, t.allocatedQuestions),
    }));
    const rescaled = syncFromCounts({ ...section, topics });
    const changeLog = [`Changed the section total from ${sectionTotal(section)} to ${newTotal} question(s), keeping the same proportions.`];
    logDropped(section, rescaled, changeLog);
    return { section: rescaled, changeLog };
}

export function applySetSubtopicCount(section: ExamBlueprintSection, args: SetSubtopicCountArgs): EditResult {
    const subtopic = findSubtopic(findTopic(section, args.topic), args.subtopic);
    if (args.count === subtopic.allocatedQuestions) {
        return { section, changeLog: [`"${args.subtopic}" already has ${args.count} question(s), so nothing changed.`] };
    }

    const changeLog: string[] = [];
    if (args.count === 0) {
        return { section: syncFromCounts(removeSubtopic(section, args.topic, args.subtopic, changeLog)), changeLog };
    }

    const updated: ExamBlueprintSection = {
        ...section,
        topics: section.topics.map((t) =>
            t.topic !== args.topic
                ? t
                : { ...t, subtopics: t.subtopics.map((s) => (s.name === args.subtopic ? { ...s, allocatedQuestions: args.count } : s)) }
        ),
    };
    const direction = args.count > subtopic.allocatedQuestions ? "up" : "down";
    changeLog.push(`Set "${args.subtopic}" (${args.topic}) to ${args.count} question(s), ${direction} from ${subtopic.allocatedQuestions}.`);
    return { section: syncFromCounts(updated), changeLog };
}

export function applySetTopicCount(section: ExamBlueprintSection, args: SetTopicCountArgs): EditResult {
    const topic = findTopic(section, args.topic);
    if (args.count === 0) return applyDeleteTopic(section, { section: args.section, topic: args.topic });
    if (args.count === topic.allocatedQuestions) {
        return { section, changeLog: [`"${args.topic}" already has ${args.count} question(s), so nothing changed.`] };
    }

    const updated: ExamBlueprintSection = {
        ...section,
        topics: section.topics.map((t) => (t.topic === args.topic ? { ...t, subtopics: distributeQuestionsAtLeastOne(t.subtopics, args.count) } : t)),
    };
    const changeLog = [`Set "${args.topic}" to ${args.count} question(s) (was ${topic.allocatedQuestions}), split across its subtopics in the same proportions.`];
    logDropped(section, updated, changeLog);
    return { section: syncFromCounts(updated), changeLog };
}

export function applyAddSubtopic(section: ExamBlueprintSection, args: AddSubtopicArgs): EditResult {
    const topic = findTopic(section, args.topic);
    if (topic.subtopics.some((s) => s.name === args.name)) {
        throw new Error(`Subtopic "${args.name}" already exists under "${args.topic}".`);
    }

    const updated: ExamBlueprintSection = {
        ...section,
        topics: section.topics.map((t) =>
            t.topic === args.topic ? { ...t, subtopics: [...t.subtopics, { name: args.name, weight: 0, allocatedQuestions: args.count }] } : t
        ),
    };
    return { section: syncFromCounts(updated), changeLog: [`Added "${args.name}" under "${args.topic}" with ${args.count} question(s).`] };
}

export function applyDeleteSubtopic(section: ExamBlueprintSection, args: DeleteSubtopicArgs): EditResult {
    findSubtopic(findTopic(section, args.topic), args.subtopic);
    const changeLog: string[] = [];
    return { section: syncFromCounts(removeSubtopic(section, args.topic, args.subtopic, changeLog)), changeLog };
}

export async function applyAddTopic(section: ExamBlueprintSection, args: AddTopicArgs, context: SectionContext): Promise<EditResult> {
    if (section.topics.some((t) => t.topic === args.name)) {
        throw new Error(`Topic "${args.name}" already exists in this section.`);
    }

    // Subtopics the teacher didn't name come from the real Subtopic Agent,
    // planned the same way as every other topic in this exam.
    let planned: { name: string; weight: number }[];
    if (args.subtopics && args.subtopics.length > 0) {
        planned = args.subtopics.map((name) => ({ name, weight: 1 }));
    } else {
        const generated = await generateSectionSubtopics(
            {
                name: section.name,
                subject: section.subject,
                question_count: args.count,
                question_type: context.question_type,
                marks: context.marks,
                topics: [args.name],
            },
            {
                globalInstructions: context.globalInstructions,
                topicInstructions: [],
                examGoal: context.examGoal,
                difficulty: context.difficulty,
                educationLevel: context.educationLevel,
            }
        );
        planned = generated.topics[0]?.subtopics ?? [{ name: args.name, weight: 1 }];
    }

    const subtopics = distributeQuestionsAtLeastOne(
        planned.map((s) => ({ name: s.name, weight: s.weight, allocatedQuestions: 0 })),
        args.count
    );
    const changeLog = [`Added topic "${args.name}" with ${args.count} question(s) across: ${subtopics.map((s) => s.name).join(", ")}.`];
    if (subtopics.length < planned.length) {
        changeLog.push(`${planned.length - subtopics.length} planned subtopic(s) were left out, because ${args.count} question(s) can't cover them all.`);
    }

    const updated: ExamBlueprintSection = {
        ...section,
        topics: [...section.topics, { topic: args.name, weight: 0, allocatedQuestions: args.count, subtopics }],
    };
    return { section: syncFromCounts(updated), changeLog };
}

export function applyDeleteTopic(section: ExamBlueprintSection, args: DeleteTopicArgs): EditResult {
    const topic = findTopic(section, args.topic);
    if (section.topics.length === 1) throw new Error("Cannot delete the only topic in a section.");

    return {
        section: syncFromCounts({ ...section, topics: section.topics.filter((t) => t.topic !== args.topic) }),
        changeLog: [`Deleted topic "${args.topic}" and its ${topic.allocatedQuestions} question(s).`],
    };
}

export function applyIncreaseTotalQuestionCount(section: ExamBlueprintSection, args: IncreaseTotalQuestionCountArgs): EditResult {
    return rescaleSection(section, args.new_total);
}
