import { AsyncLocalStorage } from "node:async_hooks";

// Whose AI key an AI call should use. Every AI call is made deep inside other code (agents, graders, background jobs), so
// rather than passing a user id through all of it, whoever starts the work says once who it is for and everything that
// runs as part of it can look it up:
//   - a signed-in web request: the person making it (set in auth.middleware.ts);
//   - grading a student's answers: the teacher who owns the exam, never the student;
//   - a background job: whoever the job was started for.
const storage = new AsyncLocalStorage<{ userId: string }>();

/** Runs `fn`, and everything it starts, on behalf of this person. */
export const runAsAiUser = <T>(userId: string, fn: () => T): T => storage.run({ userId }, fn);

/**
 * Sets the person for the rest of the current async function. For long handlers (the background functions) where wrapping
 * the whole body in `runAsAiUser` would mean re-indenting all of it. Call it once, near the top.
 */
export const bindAiUser = (userId: string): void => {
    storage.enterWith({ userId });
};

/** The person the current AI call is for, if anyone set one. */
export const currentAiUserId = (): string | null => storage.getStore()?.userId ?? null;
