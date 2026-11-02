import type { TopicWithSubtopics, AllocatedTopic } from "./Types/outputSubtopics.js";

interface Weightable {
    weight: number;
}

type QuestionAllocation<T> = T & { allocatedQuestions: number };

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Rescales weights to sum to exactly 1. Needed after anything that can drop
 * items from a weighted set (e.g. distributeQuestionsAtLeastOne keeping only
 * the top N when there are more items than questions) — the survivors' old
 * weights were relative to a larger group and no longer sum to 1 on their
 * own.
 */
export function renormalizeWeights<T extends Weightable>(items: T[]): T[] {
    const sum = items.reduce((s, i) => s + i.weight, 0);
    if (sum <= 0) {
        const equal = round3(1 / Math.max(1, items.length));
        return items.map((i) => ({ ...i, weight: equal }));
    }
    return items.map((i) => ({ ...i, weight: round3(i.weight / sum) }));
}

/**
 * Allocates totalQuestions proportional to weight (largest-remainder, so it
 * always adds up exactly), guaranteeing every item at least one question when
 * there's room. When there are more items than questions, keeps only the
 * highest-weight items (rather than silently zeroing others out via rounding).
 */
export function distributeQuestionsAtLeastOne<T extends Weightable>(
    values: T[],
    totalQuestions: number
): QuestionAllocation<T>[] {
    if (values.length === 0 || totalQuestions <= 0) return [];

    if (values.length > totalQuestions) {
        return values
            .map((value, index) => ({ value, index }))
            .sort((a, b) => b.value.weight - a.value.weight)
            .slice(0, totalQuestions)
            .map(({ value }) => ({ ...value, allocatedQuestions: 1 }));
    }

    const remainingPool = totalQuestions - values.length;
    const totalWeight = values.reduce((sum, v) => sum + v.weight, 0) || values.length;

    const exact = values.map((v) => (v.weight / totalWeight) * remainingPool);
    const floors = exact.map(Math.floor);
    // Base 1 each, plus each item's floored proportional share of the pool
    // left after giving everyone their guaranteed 1.
    const counts = floors.map((f) => 1 + f);

    let used = counts.reduce((s, c) => s + c, 0);
    const order = exact.map((e, i) => ({ i, r: e - (floors[i] ?? 0) })).sort((a, b) => b.r - a.r);

    let k = 0;
    while (used < totalQuestions) {
        counts[order[k % order.length]!.i]!++;
        used++;
        k++;
    }

    return values.map((value, i) => ({ ...value, allocatedQuestions: counts[i]! }));
}

/**
 * Rescaling variant: splits totalQuestions in proportion to weight first
 * (largest-remainder, so it adds up exactly), and only then lifts any item
 * that rounded to 0 up to 1 by taking from the largest item. Unlike
 * distributeQuestionsAtLeastOne it doesn't reserve a question per item up
 * front, so large items keep their true share. When there are more items than
 * questions, only the highest-weight items are kept.
 */
export function distributeQuestionsProportionally<T extends Weightable>(
    values: T[],
    totalQuestions: number
): QuestionAllocation<T>[] {
    if (values.length === 0 || totalQuestions <= 0) return [];
    if (values.length > totalQuestions) return distributeQuestionsAtLeastOne(values, totalQuestions);

    const weightSum = values.reduce((sum, v) => sum + v.weight, 0);
    const exact = values.map((v) => (weightSum > 0 ? v.weight / weightSum : 1 / values.length) * totalQuestions);
    const counts = exact.map(Math.floor);

    const byRemainder = exact.map((e, i) => ({ i, r: e - (counts[i] ?? 0) })).sort((a, b) => b.r - a.r);
    let leftover = totalQuestions - counts.reduce((s, c) => s + c, 0);
    for (let k = 0; leftover > 0; k++, leftover--) counts[byRemainder[k % byRemainder.length]!.i]!++;

    for (let i = 0; i < counts.length; i++) {
        if (counts[i]! > 0) continue;
        let largest = 0;
        counts.forEach((c, j) => {
            if (c > counts[largest]!) largest = j;
        });
        counts[largest]!--;
        counts[i] = 1;
    }

    return values.map((value, i) => ({ ...value, allocatedQuestions: counts[i]! }));
}

/**
 * Total questions a finalized blueprint will produce, across every section.
 * Allocation guarantees this equals the sum of the sections' question_count,
 * so it's the number to meter generation against before the pipeline runs.
 */
export function countBlueprintQuestions(sections: { topics: { allocatedQuestions: number }[] }[]): number {
    return sections.reduce(
        (total, section) => total + section.topics.reduce((n, topic) => n + topic.allocatedQuestions, 0),
        0
    );
}

/**
 * Allocates a section's question_count across its topics, then each topic's
 * share across its own subtopics. Both levels use the "at least one" variant:
 * topics because the teacher explicitly typed them into the form (rounding
 * one to zero would silently drop something they asked for), subtopics for
 * the same reason — every subtopic the agent planned should get coverage
 * when there's room for it.
 */
export function allocateSectionQuestions(topics: TopicWithSubtopics[], totalQuestions: number): AllocatedTopic[] {
    const topicsWithAllocations = renormalizeWeights(distributeQuestionsAtLeastOne(topics, totalQuestions));

    return topicsWithAllocations.map((topic) => ({
        ...topic,
        subtopics: renormalizeWeights(distributeQuestionsAtLeastOne(topic.subtopics, topic.allocatedQuestions)),
    }));
}
