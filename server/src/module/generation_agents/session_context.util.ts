import type { ExamIntentSession } from "./exam_intent_session.schema.js";
import type { SectionContext } from "./blueprint_edit_ops.js";

// Shared by the text-based review turn handler and the realtime voice tool
// handler — both need each section's form settings: to generate a newly added
// topic's subtopics, and to report the section total against the count the
// teacher set.
export function buildGenerationContextBySection(session: ExamIntentSession): Record<string, SectionContext> {
    const map: Record<string, SectionContext> = {};
    for (const section of session.examInput.sections) {
        map[section.name] = {
            question_type: section.question_type,
            marks: section.marks,
            difficulty: session.examInput.difficulty,
            educationLevel: session.examInput.educationLevel,
            globalInstructions: session.summary?.globalInstructions || [],
            examGoal: session.summary?.goal,
            targetQuestionCount: section.question_count,
        };
    }
    return map;
}
