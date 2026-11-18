import { z } from "zod";
import { zodResponseFormat } from "openai/helpers/zod";
import { getClientForModel } from "../../common/agent/openai.client.js";
import { env } from "../../env.js";
import { getQuestionBankTopicTreeSystemPrompt } from "../../prompts/question_bank_topic_tree.prompt.js";
import type { QuestionBankTopicTree } from "./question_bank.schema.js";

// A question counts under at most this many subtopics. More than that and one question shows up everywhere, which
// makes every count look bigger than it really is. Applied when reading too, so papers tagged before the limit
// existed follow it as well.
export const MAX_SUBTOPICS_PER_QUESTION = 2;

const OTHER_TOPIC = "Other";
const FLAT_TOPIC = "All topics";

/** Topics are compared ignoring capitals and extra spaces, so "Ohm's law" and "ohm's  law " are one topic. */
export const topicKey = (topic: string) => topic.trim().replace(/\s+/g, " ").toLowerCase();

/** A question's subtopics: its first few distinct tags, in the order the classifier gave them. */
export function subtopicsOf(tags: string[] | null | undefined): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const raw of tags ?? []) {
        const tag = raw.trim().replace(/\s+/g, " ");
        const key = topicKey(tag);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push(tag);
        if (out.length === MAX_SUBTOPICS_PER_QUESTION) break;
    }
    return out;
}

/** Every distinct subtopic across a paper's questions, most used first, with how many questions carry it. */
export function distinctSubtopics(questionTags: (string[] | null | undefined)[]): { name: string; count: number }[] {
    const byKey = new Map<string, { name: string; count: number }>();
    for (const tags of questionTags) {
        for (const tag of subtopicsOf(tags)) {
            const entry = byKey.get(topicKey(tag)) ?? { name: tag, count: 0 };
            entry.count++;
            byKey.set(topicKey(tag), entry);
        }
    }
    return [...byKey.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/** A tree with every subtopic under one heading: used until a paper has been grouped, or if grouping fails. */
export function flatTopicTree(names: string[]): QuestionBankTopicTree {
    if (names.length === 0) return { broadTopics: [] };
    return { broadTopics: [{ name: FLAT_TOPIC, subtopics: names.map((name) => ({ name, aliases: [topicKey(name)] })) }] };
}

const GroupingZodSchema = z.object({
    broadTopics: z.array(
        z.object({
            name: z.string(),
            subtopics: z.array(
                z.object({
                    name: z.string(),
                    merges: z.array(z.number().int()).describe("The numbers of the input subtopics that this subtopic stands for — usually exactly one."),
                })
            ),
        })
    ),
});

type Grouping = z.infer<typeof GroupingZodSchema>;

/**
 * Turns the model's grouping into a tree that is guaranteed to be complete and consistent, whatever the model did:
 * every input name ends up in exactly one subtopic (first use wins, numbers it skipped go under "Other"), numbers that
 * don't exist are ignored, and two subtopics or broad topics with the same name are merged into one.
 */
export function treeFromGrouping(names: string[], grouping: Grouping): QuestionBankTopicTree {
    const used = new Set<number>();
    const broadByKey = new Map<string, { name: string; subtopics: Map<string, { name: string; aliases: Set<string> }> }>();
    // A subtopic name may only live under one broad topic, so it is looked up across the whole tree.
    const subtopicOwner = new Map<string, { name: string; aliases: Set<string> }>();

    const place = (broadName: string, subName: string, numbers: number[]) => {
        const aliases = numbers.map((n) => topicKey(names[n - 1]!));
        const name = subName.trim() || names[numbers[0]! - 1]!;
        const key = topicKey(name);
        const existing = subtopicOwner.get(key);
        if (existing) {
            for (const alias of aliases) existing.aliases.add(alias);
            return;
        }
        const broadKey = topicKey(broadName) || topicKey(OTHER_TOPIC);
        const broad = broadByKey.get(broadKey) ?? { name: broadName.trim() || OTHER_TOPIC, subtopics: new Map() };
        broadByKey.set(broadKey, broad);
        const sub = { name, aliases: new Set([key, ...aliases]) };
        broad.subtopics.set(key, sub);
        subtopicOwner.set(key, sub);
    };

    for (const broad of grouping.broadTopics) {
        for (const sub of broad.subtopics) {
            const numbers = sub.merges.filter((n) => n >= 1 && n <= names.length && !used.has(n));
            if (numbers.length === 0) continue;
            for (const n of numbers) used.add(n);
            place(broad.name, sub.name, numbers);
        }
    }
    names.forEach((_, i) => {
        if (!used.has(i + 1)) place(OTHER_TOPIC, names[i]!, [i + 1]);
    });

    return {
        broadTopics: [...broadByKey.values()]
            .map((broad) => ({
                name: broad.name,
                subtopics: [...broad.subtopics.values()].map((sub) => ({ name: sub.name, aliases: [...sub.aliases] })),
            }))
            .filter((broad) => broad.subtopics.length > 0),
    };
}

/**
 * Groups a paper's subtopics into broad topics with one model call. The model sees only the subtopic NAMES (and how
 * many questions use each), never the questions, so the call is small. If it fails, the paper gets a flat tree rather
 * than failing: grouping is a convenience, the questions themselves are already saved.
 */
export async function buildTopicTree(questionTags: (string[] | null | undefined)[], subject: string | null): Promise<QuestionBankTopicTree> {
    const subtopics = distinctSubtopics(questionTags);
    const names = subtopics.map((s) => s.name);
    if (names.length === 0) return { broadTopics: [] };

    try {
        const client = await getClientForModel(env.GENERATION_MODEL, "question_bank_topics");
        const response = await client.chat.completions.create({
            model: env.GENERATION_MODEL,
            messages: [
                { role: "system", content: getQuestionBankTopicTreeSystemPrompt() },
                {
                    role: "user",
                    content: JSON.stringify({
                        subject: subject ?? "unknown",
                        subtopics: subtopics.map((s, i) => ({ number: i + 1, name: s.name, questions: s.count })),
                    }),
                },
            ],
            response_format: zodResponseFormat(GroupingZodSchema, "topic_tree"),
        });
        const parsed = GroupingZodSchema.parse(JSON.parse(response.choices[0]?.message.content || "{}"));
        return treeFromGrouping(names, parsed);
    } catch (err) {
        console.warn("[question-bank] grouping topics failed, using a flat topic list:", err);
        return flatTopicTree(names);
    }
}

/** The paper's most common subject, given to the grouping call as context. */
export function mainSubject(subjects: (string | null | undefined)[]): string | null {
    const counts = new Map<string, number>();
    for (const s of subjects) if (s && s !== "Unclassified") counts.set(s, (counts.get(s) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}
