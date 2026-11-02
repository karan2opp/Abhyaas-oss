import { getClientForModel } from "../../../common/agent/openai.client.js";
import { env } from "../../../env.js";
import { zodResponseFormat } from "openai/helpers/zod";
import { SectionSubtopicsOutputZodSchema, type SectionSubtopicsOutput } from "../Types/outputSubtopics.js";
import type { ISection, Difficulty, EducationLevel } from "../Types/inputExam.js";
import type { TopicSpecificInstruction } from "../Types/outputConversation.js";
import { getSubtopicsSystemPrompt } from "../../../prompts/subtopics_agent.prompt.js";

// Deterministic safety net: rescales weights so topics in a section always
// sum to exactly 1, and subtopics within each topic always sum to exactly 1,
// regardless of small rounding drift in the model's own arithmetic.
function normalizeWeights(output: SectionSubtopicsOutput): SectionSubtopicsOutput {
  const round3 = (n: number) => Math.round(n * 1000) / 1000;

  const topicSum = output.topics.reduce((sum, t) => sum + t.weight, 0);
  const topics = output.topics.map((t) => {
    const subSum = t.subtopics.reduce((sum, s) => sum + s.weight, 0);
    return {
      ...t,
      weight: topicSum > 0 ? round3(t.weight / topicSum) : t.weight,
      subtopics: t.subtopics.map((s) => ({
        ...s,
        weight: subSum > 0 ? round3(s.weight / subSum) : s.weight,
      })),
    };
  });

  return { topics };
}

export async function generateSectionSubtopics(
  section: ISection,
  context: {
    globalInstructions: string[];
    topicInstructions: TopicSpecificInstruction[];
    // What the teacher wants the exam to test (from the Exam Intent chat). Decides what kind of knowledge each topic covers.
    examGoal?: string | undefined;
    difficulty?: Difficulty | undefined;
    educationLevel?: EducationLevel | undefined;
  }
): Promise<SectionSubtopicsOutput> {
  const client = await getClientForModel(env.GENERATION_MODEL);

  const payload = {
    subject: section.subject,
    question_type: section.question_type,
    question_count: section.question_count,
    marks_per_question: section.marks,
    topics: section.topics,
    difficulty: context.difficulty,
    education_level: context.educationLevel,
    ...(context.examGoal ? { exam_goal: context.examGoal } : {}),
    global_instructions: context.globalInstructions,
    topic_specific_instructions: context.topicInstructions,
  };

  const response = await client.chat.completions.create({
    model: env.GENERATION_MODEL,
    messages: [
      { role: "system", content: getSubtopicsSystemPrompt() },
      { role: "user", content: JSON.stringify(payload) },
    ],
    response_format: zodResponseFormat(
      SectionSubtopicsOutputZodSchema,
      "section_subtopics_output"
    ),
  });

  const content = response.choices[0]?.message.content || "{}";
  const parsed = SectionSubtopicsOutputZodSchema.parse(JSON.parse(content));
  return normalizeWeights(parsed);
}
