import { getClientForModel } from "../../../common/agent/openai.client.js";
import { env } from "../../../env.js";
import { getGuardrailSystemPrompt } from "../../../prompts/evaluation_agent.prompt.js";

export const runGuardrail = async (studentAnswer: string): Promise<{ safe: boolean; reason: string | null }> => {
  const modelToUse = env.GUARDRAIL_MODEL;
  const client = await getClientForModel(modelToUse);

  try {
    const response = await client.chat.completions.create({
      model: modelToUse,
      messages: [
        { role: "system", content: getGuardrailSystemPrompt() },
        { role: "user", content: `Analyze this student answer: "${studentAnswer}"` }
      ],
      response_format: { type: "json_object" }
    });

    const resultStr = response.choices[0]?.message?.content || "{}";
    const result = JSON.parse(resultStr);

    return {
      safe: result.safe !== false,
      reason: result.reason || null
    };
  } catch (e) {
    // FAIL-CLOSED: if the guardrail itself errors we cannot verify the answer is
    // safe, so we must reject it rather than let a potential injection through.
    console.error("[Guardrail] Check failed — failing closed:", e);
    return {
      safe: false,
      reason: "Guardrail check failed. Unable to verify answer safety, so it was not evaluated.",
    };
  }
};
