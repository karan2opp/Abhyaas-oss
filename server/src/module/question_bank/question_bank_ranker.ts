import { z } from "zod";
import { zodResponseFormat } from "openai/helpers/zod";
import { getClientForModel } from "../../common/agent/openai.client.js";
import { env } from "../../env.js";

// When a topic has more matching questions than the teacher asked for, a small model puts the candidates in order of
// how well they fit what the exam is for. It only ever ranks the list it is given: it never writes or changes a
// question, so every question that comes out is still the real one from the paper.

const RankingZodSchema = z.object({
    ranking: z.array(z.number().int()).describe("The number of EVERY candidate, each exactly once, best fit first."),
});

export interface RankCandidate {
    id: string;
    // The short saved description of what the question asks, not its full text.
    description: string;
}

const SYSTEM_PROMPT = `You help a teacher choose questions for an exam. The teacher has said what the exam is for. You are given a numbered list of saved questions that all belong to one topic, each with a short description of what it asks.

Rank ALL of the questions from the best fit for the exam's purpose to the worst fit.

- Judge by what each question asks the student to do. If the purpose is numerical problems, questions that calculate something come before questions that only ask for a definition; if the purpose is a concept check, the other way round.
- Several questions will be taken from the top, so between questions that fit equally well, prefer ones that cover different ideas over near-duplicates.
- Use every number exactly once. Do not skip any and do not repeat any.`;

/**
 * Returns the candidate ids ordered best fit first. Always contains every candidate exactly once. If the model fails
 * or answers badly, the original order is kept, so one bad call never fails the whole request.
 */
export async function rankCandidatesForGoal(input: {
    goal: string;
    topic: string;
    wanted: number;
    candidates: RankCandidate[];
}): Promise<string[]> {
    const original = input.candidates.map((c) => c.id);
    try {
        const client = await getClientForModel(env.GENERATION_MODEL);
        const response = await client.chat.completions.create({
            model: env.GENERATION_MODEL,
            messages: [
                { role: "system", content: SYSTEM_PROMPT },
                {
                    role: "user",
                    content: JSON.stringify({
                        exam_goal: input.goal,
                        topic: input.topic,
                        questions_wanted: input.wanted,
                        candidates: input.candidates.map((c, i) => ({ number: i + 1, description: c.description })),
                    }),
                },
            ],
            response_format: zodResponseFormat(RankingZodSchema, "candidate_ranking"),
        });

        const parsed = RankingZodSchema.parse(JSON.parse(response.choices[0]?.message.content || "{}"));

        // Only real candidates, each once; anything the model left out goes to the end in its original order.
        const ordered: string[] = [];
        for (const n of parsed.ranking) {
            const id = input.candidates[n - 1]?.id;
            if (id && !ordered.includes(id)) ordered.push(id);
        }
        for (const id of original) if (!ordered.includes(id)) ordered.push(id);
        return ordered;
    } catch (err) {
        console.warn("[question-bank] ranking candidates failed, keeping the search order:", err);
        return original;
    }
}
