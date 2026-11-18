// Live counts for the past-paper topic picker. One question can belong to two subtopics but can only be used once, so
// "how many more can this subtopic give" depends on everything already picked. A copy of the server's maxPlacement
// (server/src/module/question_bank/question_bank_matching.ts); keep the two in step.

interface MatchSlot {
  demand: number;
  candidates: number[];
}

/** The most questions that can be placed into the slots at once, each used at most once, no slot over its demand. */
function maxPlacement(slots: MatchSlot[]): number {
  const slotsOf = new Map<number, number[]>();
  slots.forEach((slot, i) => {
    if (slot.demand <= 0) return;
    for (const q of slot.candidates) {
      const list = slotsOf.get(q) ?? [];
      if (!list.includes(i)) list.push(i);
      slotsOf.set(q, list);
    }
  });

  const load: number[][] = slots.map(() => []);
  const tryPlace = (q: number, visited: Set<number>): boolean => {
    for (const s of slotsOf.get(q) ?? []) {
      if (visited.has(s)) continue;
      visited.add(s);
      if (load[s].length < slots[s].demand) {
        load[s].push(q);
        return true;
      }
      for (let k = 0; k < load[s].length; k++) {
        if (tryPlace(load[s][k], visited)) {
          load[s][k] = q;
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
 * For one paper: how many MORE questions each subtopic can still give, without taking any away from what is already
 * picked elsewhere. Questions that fit only one subtopic are always used first, so picking from Arrays → Searching only
 * lowers Searching → Linear search once a question both share actually has to be used.
 *
 * `questions` is the paper's list of subtopic keys per question; `picked` is subtopic key -> count.
 */
export function remainingBySubtopic(questions: string[][], picked: Record<string, number>): Record<string, number> {
  const candidatesOf = new Map<string, number[]>();
  questions.forEach((keys, q) => {
    for (const key of keys) candidatesOf.set(key, [...(candidatesOf.get(key) ?? []), q]);
  });

  const keys = [...candidatesOf.keys()];
  const slots = keys.map((key) => ({ demand: picked[key] ?? 0, candidates: candidatesOf.get(key)! }));
  const placedNow = maxPlacement(slots);

  const remaining: Record<string, number> = {};
  keys.forEach((key, i) => {
    const raised = slots.map((slot, j) => (j === i ? { ...slot, demand: slot.candidates.length } : slot));
    remaining[key] = maxPlacement(raised) - placedNow;
  });
  return remaining;
}
