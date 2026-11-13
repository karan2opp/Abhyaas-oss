import { evaluateAnswer, isBlankAnswer, type EvaluationOutcome, type ResponseMode, type TextAnswer } from "./evalutaion.js";
import { toAiKeyApiError } from "../ai_keys/ai_key.service.js";
import type { ApiError } from "../../common/utils/ApiError.js";

// Grades a list of written answers one answer at a time and saves each as soon as it is done (through `save`, so exams and
// assignments can store them in their own tables). Shared by the exam and assignment grading jobs.

// How a grading run is paid for, one answer at a time: `claim` asks whether another answer may be graded, `charge` counts it
// once it is graded, and `release` gives the place back.
export interface GradeGate {
    claim(): Promise<boolean>;
    charge(): Promise<void>;
    release(): void;
}

export interface GradeSummary {
    graded: number;
    // Not graded because the plan has no AI grading left.
    outOfQuota: TextAnswer[];
    // Not graded because OpenAI turned the teacher's key down; `keyError` is the readable reason.
    keyRejected: TextAnswer[];
    keyError: ApiError | null;
    // Failures that are worth trying again (the job retries; answers already graded are kept).
    failures: unknown[];
}

export const gradeAnswers = async (
    items: TextAnswer[],
    mode: ResponseMode,
    save: (answer: TextAnswer, outcome: EvaluationOutcome) => Promise<void>,
    gate?: GradeGate
): Promise<GradeSummary> => {
    const summary: GradeSummary = { graded: 0, outOfQuota: [], keyRejected: [], keyError: null, failures: [] };

    await Promise.all(items.map(async (answer) => {
        // An empty answer is marked 0 without any AI work, so it is neither charged nor held up by the plan.
        const needsAi = !isBlankAnswer(answer.studentAnswer);
        let claimed = false;
        if (needsAi && gate) {
            if (summary.keyError) {
                summary.keyRejected.push(answer);
                return;
            }
            if (!(await gate.claim())) {
                summary.outOfQuota.push(answer);
                return;
            }
            claimed = true;
        }

        try {
            const outcome = await evaluateAnswer(answer, mode);
            await save(answer, outcome);
            if (claimed) await gate!.charge();
            summary.graded++;
        } catch (err) {
            const keyProblem = await toAiKeyApiError(err);
            if (keyProblem) {
                summary.keyError ??= keyProblem;
                summary.keyRejected.push(answer);
            } else {
                summary.failures.push(err);
            }
        } finally {
            if (claimed) gate!.release();
        }
    }));

    return summary;
};

