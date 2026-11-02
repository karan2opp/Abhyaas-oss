// Builds the minimal view of an exam's structure handed to the Question
// Review Agent, from getSectionsWithDetails's raw output — used by both the
// text turn handler and the realtime/voice session, so both see the same
// trimmed shape.
//
// getSectionsWithDetails returns full DB rows plus, per section, EVERY
// question twice: once nested under its block (section.blocks[].questions)
// and again in a flat section.questions "for backward-compatible readers".
// Sent as-is, that means every question — and its options, and their
// content — is duplicated in full on every single turn, on top of carrying
// timestamps, foreign keys the nesting already implies, and always-null
// fields (rubric on an MCQ, modelAnswer on everything) that cost tokens and
// attention without ever being useful to this agent.
//
// This keeps exactly one copy of each question and only the fields the
// agent actually acts on: id, type, text, marks, options/rubric, and
// content_blocks/images only when non-empty.

interface RawOption {
    id: string;
    value: string;
    isCorrect: boolean;
    isCode?: boolean;
}

interface RawQuestion {
    id: string;
    type: "mcq" | "descriptive";
    description: string;
    marks: number;
    contentBlocks?: unknown[] | null;
    images?: unknown[] | null;
    rubric?: unknown | null;
    options?: RawOption[];
}

interface RawBlock {
    id: string;
    name: string;
    subject: string;
    questions?: RawQuestion[];
}

interface RawSection {
    id: string;
    title: string;
    blocks?: RawBlock[];
    questions?: RawQuestion[];
}

function trimQuestion(q: RawQuestion, number: number) {
    const trimmed: Record<string, unknown> = {
        // "number" is what the teacher sees on screen and says out loud
        // ("question 9") — the id is what the agent's tools take. Never the
        // same value, and the agent must never surface the id to the
        // teacher; see the prompt's ID HANDLING section.
        number,
        id: q.id,
        type: q.type,
        text: q.description,
        marks: q.marks,
    };

    if (q.contentBlocks && q.contentBlocks.length > 0) trimmed.contentBlocks = q.contentBlocks;
    if (q.images && q.images.length > 0) trimmed.images = q.images;

    if (q.type === "mcq") {
        trimmed.options = (q.options ?? []).map((o) => ({
            id: o.id,
            text: o.value,
            isCorrect: o.isCorrect,
            ...(o.isCode && { isCode: true }),
        }));
    } else if (q.rubric) {
        trimmed.rubric = q.rubric;
    }

    return trimmed;
}

export function buildQuestionReviewContext(sections: RawSection[]) {
    return sections.map((section) => {
        const blocks = section.blocks ?? [];
        const hasBlocks = blocks.length > 0;

        // The client numbers questions "Q1, Q2, ..." per section, in this
        // exact flat, creation-ordered array — resetting to 1 at the start
        // of every section. Computed once here from that same array (now
        // that getSectionsWithDetails orders it deterministically) so the
        // agent's numbers are guaranteed to match what's on the teacher's
        // screen, regardless of how blocks group the same questions below.
        const numberById = new Map((section.questions ?? []).map((q, i) => [q.id, i + 1]));
        const numberOf = (q: RawQuestion) => numberById.get(q.id) ?? -1;

        if (!hasBlocks) {
            return {
                id: section.id,
                title: section.title,
                questions: (section.questions ?? []).map((q) => trimQuestion(q, numberOf(q))),
            };
        }

        // A question always has EITHER a blockId or none — the flat list
        // holds both, so anything not already covered by a block is one
        // that genuinely sits directly under the section.
        const coveredIds = new Set(blocks.flatMap((b) => (b.questions ?? []).map((q) => q.id)));
        const unblocked = (section.questions ?? []).filter((q) => !coveredIds.has(q.id));

        return {
            id: section.id,
            title: section.title,
            blocks: blocks.map((b) => ({
                id: b.id,
                name: b.name,
                subject: b.subject,
                questions: (b.questions ?? []).map((q) => trimQuestion(q, numberOf(q))),
            })),
            ...(unblocked.length > 0 && { questions: unblocked.map((q) => trimQuestion(q, numberOf(q))) }),
        };
    });
}
