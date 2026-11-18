// System prompt for grouping a paper's subtopics into broad topics (question_bank/question_bank_topic_tree.ts).
export function getQuestionBankTopicTreeSystemPrompt(): string {
    return `You organise the topics of one previous-year exam paper so a teacher can browse them. Every question in the paper was already tagged with one or two specific subtopics. You are given the numbered list of every distinct subtopic name used in the paper, with how many questions carry it, and the paper's subject.

Group the subtopics into BROAD TOPICS, the way a syllabus groups lessons into chapters. Example for a programming paper: broad topic "Arrays" holding "Searching in arrays", "Sorting", "Insertion and deletion"; broad topic "Recursion" holding "Base case", "Recursive tree traversal".

Rules:
- Every subtopic number goes into exactly one subtopic of exactly one broad topic. Do not skip any number and do not use any number twice.
- A broad topic name is short (one to four words) and is a chapter-level idea a teacher would recognise. Aim for roughly 3 to 10 broad topics; a small paper can have fewer.
- You MAY merge several numbers into one subtopic, but ONLY when they are the same idea worded differently (spelling, capitals, singular/plural, "Binary search" vs "Binary search algorithm"). Never merge two different ideas just because they are related: "Linear search" and "Binary search" stay separate.
- A subtopic's "name" is the clearest of the merged names, or a light tidy-up of it. Do not invent a new idea.
- When a subtopic could belong to two broad topics, choose the one a teacher would most expect to find it under. Questions that really span two broad topics are handled separately — they carry two subtopics.
- Avoid a catch-all broad topic such as "Miscellaneous" unless a subtopic truly fits nowhere else.`;
}
