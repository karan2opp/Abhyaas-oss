// Bridges the legacy "sections -> blocks -> topics -> subtopics" shape that
// QuestionBuilder's config form and BlueprintTreeViewer both speak, to the
// new generation_agents backend's flat "sections -> topics -> subtopics"
// shape (a new-pipeline "section" is what the old UI calls a "block" — one
// subject/type/count-scoped unit). Every flattened section gets a synthetic
// name; a mapping table (built once, in the same order every time) is the
// only thing that lets later steps regroup a flat response back under its
// original section/block.
import type {
  ExamInput,
  SectionInput,
  TopicInput,
  QuestionType,
  Difficulty,
  ExamBlueprintSection,
  GeneratedExam,
  GeneratedOption,
} from "@/services/generationAgents.service";

export interface LegacyBlueprintSubtopic {
  name: string;
  weight?: number;
  allocatedQuestions: number;
  sourceNodeIds?: string[];
}

export interface LegacyBlueprintTopic {
  topic: string;
  weight?: number;
  subtopics: LegacyBlueprintSubtopic[];
}

export interface LegacyBlueprintBlock {
  name: string;
  subject: string;
  question_type: string;
  total_marks: number;
  instructions?: string[];
  topics: LegacyBlueprintTopic[];
  unmatchedTopics?: string[];
}

export interface LegacyBlueprintSection {
  name: string;
  targetSectionId?: string | null;
  blocks: LegacyBlueprintBlock[];
}

export interface LegacyBlueprintTree {
  title: string;
  exam_type?: string;
  instructions?: string[];
  sections: LegacyBlueprintSection[];
}

export interface SectionBlockMapEntry {
  flatName: string;
  sectionName: string;
  targetSectionId: string | null;
  blockName: string;
  questionType: string;
  marksPerQuestion: number;
  // The question count set on the exam form, checked against the plan's total before generating.
  questionCount: number;
}

// Config form's local `sections` state -> new backend's flat examInput, plus
// the mapping table every later step needs.
export function buildExamInputFromConfig(
  configSections: any[],
  instructions: string[],
  bookId?: string,
  difficulty?: Difficulty
): { examInput: ExamInput; mapping: SectionBlockMapEntry[]; title: string } {
  const mapping: SectionBlockMapEntry[] = [];
  const flatSections: SectionInput[] = [];

  configSections.forEach((section, sIdx) => {
    const sectionName = section.name.trim();
    const questionType = (section.questionType || "mcq").toLowerCase();
    const marksPerQuestion = Math.max(1, Number(section.marksPerQuestion) || 1);
    const qCount = Math.max(1, Math.round(Number(section.numberOfQuestions) || 5));
    const flatName = `s${sIdx}::${sectionName}`;
    const topics: TopicInput[] = section.topics.map((t: string) => t.trim()).filter((t: string) => t !== "");

    // BlueprintTreeViewer still expects a "blocks" layer — this pipeline
    // has none, so every section synthesizes exactly one implicit block
    // ("Main") purely to satisfy that display/save contract.
    mapping.push({
      flatName,
      sectionName,
      targetSectionId: section.targetSectionId || null,
      blockName: "Main",
      questionType,
      marksPerQuestion,
      questionCount: qCount,
    });

    flatSections.push({
      name: flatName,
      subject: section.subject.trim(),
      question_count: qCount,
      question_type: questionType as QuestionType,
      marks: marksPerQuestion,
      topics,
    });
  });

  const title = `${(configSections[0]?.subject?.trim() || "Untitled")} Exam`;
  return { examInput: { title, instructions, ...(bookId ? { bookId } : {}), ...(difficulty ? { difficulty } : {}), sections: flatSections }, mapping, title };
}

// New backend's flat sections -> old nested tree shape, for
// BlueprintTreeViewer and the refinement chat's display. Zips by index —
// flat section order always matches mapping order (both built/preserved in
// the same s-then-b iteration end to end), which is robust to the teacher
// renaming a block afterward, unlike a name-based lookup.
export function sectionsToLegacyTree(
  sections: ExamBlueprintSection[],
  mapping: SectionBlockMapEntry[],
  title: string,
  instructions: string[]
): LegacyBlueprintTree {
  const bySectionName = new Map<string, LegacyBlueprintSection>();
  const order: string[] = [];

  sections.forEach((flatSection, i) => {
    const entry = mapping[i];
    if (!entry) return;

    if (!bySectionName.has(entry.sectionName)) {
      bySectionName.set(entry.sectionName, {
        name: entry.sectionName,
        targetSectionId: entry.targetSectionId,
        blocks: [],
      });
      order.push(entry.sectionName);
    }

    const totalQuestions = flatSection.topics.reduce(
      (sum, t) => sum + t.subtopics.reduce((s, st) => s + st.allocatedQuestions, 0),
      0
    );

    bySectionName.get(entry.sectionName)!.blocks.push({
      name: entry.blockName,
      subject: flatSection.subject,
      question_type: entry.questionType,
      total_marks: Math.round(totalQuestions * entry.marksPerQuestion),
      topics: flatSection.topics.map((t) => ({
        topic: t.topic,
        weight: t.weight,
        subtopics: t.subtopics.map((st) => ({
          name: st.name,
          weight: st.weight,
          allocatedQuestions: st.allocatedQuestions,
          ...(st.sourceNodeIds ? { sourceNodeIds: st.sourceNodeIds } : {}),
        })),
      })),
      ...(flatSection.unmatchedTopics ? { unmatchedTopics: flatSection.unmatchedTopics } : {}),
    });
  });

  return { title, instructions, sections: order.map((name) => bySectionName.get(name)!) };
}

// Old nested tree (possibly hand-edited via BlueprintTreeViewer, or by the
// refinement chat) -> flat sections for the new backend. Weight is
// renormalized per topic/subtopic group since direct tree edits never touch
// it — left alone it would drift meaningless after any manual edit.
export function legacyTreeToSections(tree: LegacyBlueprintTree, mapping: SectionBlockMapEntry[]): ExamBlueprintSection[] {
  const sections: ExamBlueprintSection[] = [];
  let i = 0;

  for (const section of tree.sections) {
    for (const block of section.blocks) {
      const entry = mapping[i];
      i++;
      const flatName = entry?.flatName ?? `${section.name}::${block.name}`;

      const topicWeightSum = block.topics.reduce((s, t) => s + (t.weight ?? 0), 0);

      sections.push({
        name: flatName,
        subject: block.subject,
        topics: block.topics.map((t) => {
          const topicQuestions = t.subtopics.reduce((s, st) => s + (st.allocatedQuestions || 0), 0);
          const subWeightSum = t.subtopics.reduce((s, st) => s + (st.weight ?? 0), 0);
          return {
            topic: t.topic,
            weight: topicWeightSum > 0 ? (t.weight ?? 0) / topicWeightSum : 1 / block.topics.length,
            allocatedQuestions: topicQuestions,
            subtopics: t.subtopics.map((st) => ({
              name: st.name,
              weight: subWeightSum > 0 ? (st.weight ?? 0) / subWeightSum : 1 / t.subtopics.length,
              allocatedQuestions: st.allocatedQuestions || 0,
              ...(st.sourceNodeIds ? { sourceNodeIds: st.sourceNodeIds } : {}),
            })),
          };
        }),
        ...(block.unmatchedTopics ? { unmatchedTopics: block.unmatchedTopics } : {}),
      });
    }
  }

  return sections;
}

export function computeTotalQuestions(sections: ExamBlueprintSection[]): number {
  return sections.reduce(
    (sum, sec) => sum + sec.topics.reduce((s, t) => s + t.subtopics.reduce((ss, st) => ss + st.allocatedQuestions, 0), 0),
    0
  );
}

export function computeGeneratedCount(generated: GeneratedExam | null): number {
  if (!generated) return 0;
  return generated.sections.reduce((sum, sec) => sum + sec.topics.reduce((s, t) => s + t.questions.length, 0), 0);
}

const MCQ_OPTION_LETTERS = ["A", "B", "C", "D"] as const;

function mapMcqOptionsForSave(options: GeneratedOption[], correctOption: string) {
  return options.map((opt, idx) => ({ value: opt.text, isCode: opt.isCode, isCorrect: correctOption === MCQ_OPTION_LETTERS[idx] }));
}

// Finished GeneratedExam (flat sections) -> the shape `/exams/save-generated`
// expects (sections -> blocks -> questions, targetSectionId-aware).
export function generatedExamToSaveShape(generatedExam: GeneratedExam, mapping: SectionBlockMapEntry[]) {
  const bySectionName = new Map<string, any>();
  const order: string[] = [];

  generatedExam.sections.forEach((flatSection, i) => {
    const entry = mapping[i];
    if (!entry) return;

    if (!bySectionName.has(entry.sectionName)) {
      bySectionName.set(entry.sectionName, {
        targetSectionId: entry.targetSectionId || undefined,
        name: entry.sectionName,
        blocks: [],
      });
      order.push(entry.sectionName);
    }

    const questions = flatSection.topics.flatMap((t) =>
      t.questions.map((q) =>
        q.type === "mcq"
          ? { type: "mcq", topic: q.topic, subtopic: q.subtopic, description: q.question_text, marks: q.marks, options: mapMcqOptionsForSave(q.options, q.correct_option), contentBlocks: q.content_blocks }
          : { type: "descriptive", topic: q.topic, subtopic: q.subtopic, description: q.question_text, marks: q.marks, rubric: q.rubric, contentBlocks: q.content_blocks }
      )
    );

    bySectionName.get(entry.sectionName)!.blocks.push({
      name: entry.blockName,
      subject: flatSection.subject,
      question_type: entry.questionType,
      total_marks: questions.reduce((s, q) => s + (q.marks || 0), 0),
      instructions: [],
      questions,
    });
  });

  return { sections: order.map((name) => bySectionName.get(name)!) };
}
