import type { GeneratedQuestion } from "./Types/outputGeneration.js";

const LETTERS = ["A", "B", "C", "D"] as const;

// The model sometimes emits a NUL character where a LaTeX backslash belongs
// (e.g. "$\u0000ce{H2O}$" for "$\ce{H2O}$"). PostgreSQL can't store NUL in
// text or jsonb, so one such question makes the whole save fail. It never
// appears legitimately, so it's turned back into the backslash it replaced.
export function restoreNullBackslashes<T>(value: T): T {
    if (typeof value === "string") return value.replace(/\u0000/g, "\\") as T;
    if (Array.isArray(value)) return value.map(restoreNullBackslashes) as T;
    if (value && typeof value === "object") {
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, restoreNullBackslashes(v)])) as T;
    }
    return value;
}

// Models put the correct answer at the same position far more often than
// chance (one test exam had it at A in all 28 MCQs), so AI-written MCQs get
// their options shuffled, with correct_option moved to wherever the right
// answer lands.
export function shuffleMcqOptions(question: GeneratedQuestion): GeneratedQuestion {
    if (question.type !== "mcq") return question;
    const correctText = question.options[LETTERS.indexOf(question.correct_option)];
    const options = [...question.options];
    for (let i = options.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [options[i], options[j]] = [options[j]!, options[i]!];
    }
    return { ...question, options, correct_option: LETTERS[options.indexOf(correctText!)]! };
}
