import { AsyncLocalStorage } from "node:async_hooks";

// Who an AI call is for. Calls are made deep inside other code (agents, graders, background jobs), so whoever starts the
// work says once who it is for and every call made as part of it can look it up for the usage log:
//   - a signed-in web request: the person and their organisation (set in auth.middleware.ts);
//   - grading: the exam or assignment, its owner and organisation;
//   - a background job: whoever it was started for.
export interface UsageContext {
    userId?: string | null;
    organisationId?: string | null;
    examId?: string | null;
    assignmentId?: string | null;
}

const storage = new AsyncLocalStorage<UsageContext>();

/** Runs `fn`, and everything it starts, with this context added to the current one. */
export const runWithUsageContext = <T>(context: UsageContext, fn: () => T): T => storage.run({ ...(storage.getStore() ?? {}), ...context }, fn);

/** Adds to the context for the rest of the current async function. For long handlers where wrapping the body would mean re-indenting it. */
export const bindUsageContext = (context: UsageContext): void => {
    storage.enterWith({ ...(storage.getStore() ?? {}), ...context });
};

/** The context of the current AI call; empty when nobody set one. */
export const currentUsageContext = (): UsageContext => storage.getStore() ?? {};

/**
 * Inngest runs the code of each `step.run` from its own machinery, so a context set at the top of a function (bindUsageContext)
 * does not reach it. This returns the same `step` with the context put round the code of every `step.run`, so the AI calls made
 * inside a step are logged for the right person and organisation.
 */
export const withUsageSteps = <T extends { run: (...args: any[]) => any }>(step: T, context: UsageContext, around: <R>(fn: () => R) => R = (fn) => fn()): T =>
    new Proxy(step, {
        get(target, prop) {
            const value = Reflect.get(target, prop);
            if (prop !== "run" || typeof value !== "function") return typeof value === "function" ? value.bind(target) : value;
            return (id: any, fn: (...a: any[]) => any, ...rest: any[]) => value.call(target, id, (...args: any[]) => around(() => runWithUsageContext(context, () => fn(...args))), ...rest);
        },
    });
