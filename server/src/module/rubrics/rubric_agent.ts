import { z } from "zod";
import { zodResponseFormat } from "openai/helpers/zod";
import { getClientForModel } from "../../common/agent/openai.client.js";
import { env } from "../../env.js";
import { getRubricSystemPrompt } from "../../prompts/rubric_agent.prompt.js";

export interface RubricQuestion {
    id: string;
    description: string;
    marks: number;
    contentBlocks: unknown[] | null;
}

export interface Rubric {
    categories: { name: string; weight: number; key_points: string[] }[];
}

const RubricCategoryZodSchema = z.object({
    name: z.string().describe("The name of the category (e.g. Definition, Concept Knowledge, Example, Correct Application, Depth of Reasoning)"),
    weight: z.number().describe("The weight of this category (a number between 0 and 1); all categories of one question sum to 1"),
    key_points: z.array(z.string()).describe("The concrete points a correct answer makes for this category"),
});

const RubricBatchZodSchema = z.object({
    rubrics: z.array(
        z.object({
            question_id: z.string().describe("The id of the question, exactly as it was given"),
            categories: z.array(RubricCategoryZodSchema),
        })
    ),
});

// Grading multiplies each category's score by its weight, so weights that don't sum to 1 would silently scale every
// student's mark up or down.
const normalizeWeights = (categories: Rubric["categories"]): Rubric["categories"] => {
    const sum = categories.reduce((s, c) => s + Math.max(0, c.weight), 0);
    return categories.map((c) => ({
        ...c,
        weight: Math.round((sum > 0 ? Math.max(0, c.weight) / sum : 1 / categories.length) * 1000) / 1000,
    }));
};

/**
 * Writes the rubric for a small batch of descriptive questions in one call, following the teacher's evaluation scheme when
 * there is one. Throws when the reply leaves a question out or gives it no categories, so the caller's retry asks again.
 */
export async function generateRubrics(questions: RubricQuestion[], scheme: string | null): Promise<Map<string, Rubric>> {
    const client = await getClientForModel(env.GENERATION_MODEL);

    const payload = {
        ...(scheme ? { evaluation_scheme: scheme } : {}),
        questions: questions.map((q) => ({
            id: q.id,
            question_text: q.description,
            marks: q.marks,
            content_blocks: q.contentBlocks && q.contentBlocks.length > 0 ? q.contentBlocks : null,
        })),
    };

    const response = await client.chat.completions.create({
        model: env.GENERATION_MODEL,
        messages: [
            { role: "system", content: getRubricSystemPrompt(!!scheme) },
            { role: "user", content: JSON.stringify(payload) },
        ],
        response_format: zodResponseFormat(RubricBatchZodSchema, "rubric_batch"),
    });

    const parsed = RubricBatchZodSchema.parse(JSON.parse(response.choices[0]?.message.content || "{}"));

    const byId = new Map<string, Rubric>();
    for (const item of parsed.rubrics) {
        if (item.categories.length > 0) byId.set(item.question_id, { categories: normalizeWeights(item.categories) });
    }

    const missing = questions.filter((q) => !byId.has(q.id));
    if (missing.length > 0) {
        throw new Error(`The rubric writer left out ${missing.length} of ${questions.length} question(s).`);
    }
    return byId;
}
