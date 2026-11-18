// Filling a teacher's picks ("3 from Arrays → Searching, 2 from Searching → Linear search") with questions, when one
// question can belong to more than one of the picked subtopics but may only be used once.
//
// This is a matching problem: questions on one side, picks on the other, each pick taking up to its count. The method
// below (augmenting paths) finds the most questions that can be placed at once. When a pick is full, it checks whether
// one of the questions already in it could move to another pick it also fits, freeing the space. That is what makes
// "use the questions that fit nowhere else first" come out right on its own, even with three or four overlapping picks.
//
// The client has its own copy of maxPlacement (client/src/lib/pyqMatching.ts) to show live counts; keep them in step.

export interface MatchSlot {
    // How many questions this pick wants.
    demand: number;
    // The questions that may fill it.
    candidates: string[];
}

/** The most questions that can be placed into the slots at once, each used at most once, no slot over its demand. */
export function maxPlacement(slots: MatchSlot[]): number {
    const slotsOf = new Map<string, number[]>();
    slots.forEach((slot, i) => {
        if (slot.demand <= 0) return;
        for (const q of slot.candidates) {
            const list = slotsOf.get(q) ?? [];
            if (!list.includes(i)) list.push(i);
            slotsOf.set(q, list);
        }
    });

    const load: string[][] = slots.map(() => []);
    const tryPlace = (q: string, visited: Set<number>): boolean => {
        for (const s of slotsOf.get(q) ?? []) {
            if (visited.has(s)) continue;
            visited.add(s);
            if (load[s]!.length < slots[s]!.demand) {
                load[s]!.push(q);
                return true;
            }
            for (let k = 0; k < load[s]!.length; k++) {
                if (tryPlace(load[s]![k]!, visited)) {
                    load[s]![k] = q;
                    return true;
                }
            }
        }
        return false;
    };

    let placed = 0;
    for (const q of slotsOf.keys()) if (tryPlace(q, new Set())) placed++;
    return placed;
}

/**
 * Chooses the actual questions for every slot. Each slot's candidates come in order of preference (best fit for the
 * exam's goal, or questions that fit nowhere else first). Slots with the least room to spare are filled first, and a
 * preferred question that other slots also want is only taken if every slot can still get as many questions as it
 * could before. So the result is always as full as the papers allow, and within that, follows the preference order.
 *
 * Returns the chosen question ids per slot, in the same order as the input slots.
 */
export function assignQuestions(slots: MatchSlot[]): string[][] {
    const best = maxPlacement(slots);
    const chosen: string[][] = slots.map(() => []);
    const used = new Set<string>();

    const placedIfTaken = () =>
        chosen.reduce((n, c) => n + c.length, 0) +
        maxPlacement(
            slots.map((slot, i) => ({
                demand: slot.demand - chosen[i]!.length,
                candidates: slot.candidates.filter((q) => !used.has(q)),
            }))
        );

    const order = slots.map((_, i) => i).sort((a, b) => slots[a]!.candidates.length - slots[a]!.demand - (slots[b]!.candidates.length - slots[b]!.demand));

    for (const i of order) {
        const slot = slots[i]!;
        for (const q of slot.candidates) {
            if (chosen[i]!.length >= slot.demand) break;
            if (used.has(q)) continue;

            used.add(q);
            chosen[i]!.push(q);
            // A question no other unfinished slot can use can't cost anyone anything, so only shared ones are checked.
            const shared = slots.some((other, j) => j !== i && other.demand > chosen[j]!.length && other.candidates.includes(q));
            if (shared && placedIfTaken() < best) {
                used.delete(q);
                chosen[i]!.pop();
            }
        }
    }

    return chosen;
}
