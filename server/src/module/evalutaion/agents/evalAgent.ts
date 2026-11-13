import { getClientForModel } from "../../../common/agent/openai.client.js";
import { asAiKeyProblem } from "../../../common/agent/ai_errors.js";
import { env } from "../../../env.js";
import { getGuardrailSystemPrompt } from "../../../prompts/evaluation_agent.prompt.js";

// Models that only accept their default sampling settings (the reasoning models) reject a temperature, so it is set for the others only.
export const samplingFor = (model: string): { temperature?: number } => (/^(o\d|gpt-5)/i.test(model) ? {} : { temperature: 0 });

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Asks the guardrail model whether a student's answer is trying to steer the grader.
 *
 * It never decides "unsafe" because of its own failure: if the check cannot be completed (after a retry) this throws, so the
 * answer is not graded now and the job retries later, instead of a student being given 0 for a hiccup on our side.
 */
export const runGuardrail = async (studentAnswer: string): Promise<{ safe: boolean; reason: string | null }> => {
  const modelToUse = env.GUARDRAIL_MODEL;
  const client = await getClientForModel(modelToUse);

  let attempt = 0;
  while (true) {
    try {
      const response = await client.chat.completions.create({
        model: modelToUse,
        ...samplingFor(modelToUse),
        messages: [
          { role: "system", content: getGuardrailSystemPrompt() },
          // The answer travels as a JSON string, so quotes or brackets inside it cannot end the data part early.
          { role: "user", content: JSON.stringify({ student_answer: studentAnswer }) },
        ],
        response_format: { type: "json_object" },
      });

      const result = JSON.parse(response.choices[0]?.message?.content || "{}");
      return {
        safe: result.safe !== false,
        reason: result.reason || null,
      };
    } catch (e) {
      // A rejected key will not get better by asking again.
      if (asAiKeyProblem(e) || attempt >= 1) {
        console.error("[Guardrail] Check failed:", e);
        throw e;
      }
      attempt++;
      await sleep(1000);
    }
  }
};
