import api from "@/utils/axios";

// ------------- EXAMS -------------
export const createExamService = async (data: any) => {
  const res = await api.post("/exams", data);
  return res.data;
};

export const getExamsService = async (params?: { page?: number, limit?: number, search?: string, days?: string, status?: string }) => {
  const res = await api.get("/exams", { params });
  return res.data;
};

export const getTeacherOverviewStatsService = async () => {
  const res = await api.get("/exams/overview/stats");
  return res.data;
};

export const getExamByIdService = async (id: string) => {
  const res = await api.get(`/exams/${id}`);
  return res.data;
};

export const updateExamService = async (id: string, data: any) => {
  const res = await api.patch(`/exams/${id}`, data);
  return res.data;
};

export const deleteExamService = async (id: string) => {
  const res = await api.delete(`/exams/${id}`);
  return res.data;
};

// ------------- SECTIONS -------------
export const createSectionService = async (data: any) => {
  const res = await api.post("/sections", data);
  return res.data;
};

export const getSectionsWithDetailsService = async (examId: string) => {
  const res = await api.get(`/sections/${examId}/details`);
  return res.data;
};

export const updateSectionService = async (id: string, data: any) => {
  const res = await api.patch(`/sections/${id}`, data);
  return res.data;
};

export const deleteSectionService = async (id: string) => {
  const res = await api.delete(`/sections/${id}`);
  return res.data;
};

// ------------- QUESTIONS -------------
export const createQuestionService = async (data: any) => {
  const res = await api.post("/questions", data);
  return res.data;
};

export const saveGeneratedExamService = async (data: any) => {
  const res = await api.post("/exams/save-generated", data);
  return res.data;
};

// Adds one topic to a draft exam: the AI plans its subtopics and writes the questions (can take up to a minute).
export const addTopicService = async (examId: string, data: { sectionId: string; blockId: string; topic: string; description?: string; count: number; difficulty?: string }) => {
  const res = await api.post(`/exams/${examId}/topics`, data);
  return res.data;
};

// Removes a topic from a draft exam by deleting the questions tagged with it.
export const removeTopicService = async (examId: string, data: { sectionId: string; topic: string }) => {
  const res = await api.post(`/exams/${examId}/topics/remove`, data);
  return res.data;
};

export const updateQuestionService = async (id: string, data: any) => {
  const res = await api.patch(`/questions/${id}`, data);
  return res.data;
};

export const deleteQuestionService = async (id: string) => {
  const res = await api.delete(`/questions/${id}`);
  return res.data;
};

// ------------- SUBMISSIONS -------------
export const getExamSubmissionsService = async (examId: string) => {
  const res = await api.get(`/submissions/exam/${examId}`);
  return res.data;
};

export const getExamLeaderboardService = async (examId: string) => {
  const res = await api.get(`/submissions/exam/${examId}/leaderboard`);
  return res.data;
};

export const gradeExamSubmissionService = async (
  submissionId: string,
  data: { answers: { answerId: string; marksAwarded: number; feedback?: string }[]; overallFeedback?: string }
) => {
  const res = await api.patch(`/submissions/${submissionId}/grade`, data);
  return res.data;
};

export const evaluateExamSubmissionWithAiService = async (
  submissionId: string,
  data: { mode?: "marks_only" | "marks_and_feedback" }
) => {
  const res = await api.post(`/submissions/${submissionId}/evaluate-ai`, data);
  return res.data;
};
