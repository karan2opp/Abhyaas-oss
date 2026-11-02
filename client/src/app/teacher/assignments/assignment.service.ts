import api from "@/utils/axios";

// ------------- SERIES -------------
export const createSeriesService = async (data: { title: string; type?: "weekly" | "custom" }) => {
  const res = await api.post("/assignments/series", data);
  return res.data;
};

export const listMySeriesService = async () => {
  const res = await api.get("/assignments/series");
  return res.data;
};

export const updateSeriesService = async (id: string, data: { title: string }) => {
  const res = await api.patch(`/assignments/series/${id}`, data);
  return res.data;
};

export const deleteSeriesService = async (id: string) => {
  const res = await api.delete(`/assignments/series/${id}`);
  return res.data;
};

// ------------- ASSIGNMENTS -------------
export const createAssignmentService = async (data: {
  title: string;
  instructions?: string;
  totalMarks: number;
  startDate?: string;
  dueDate?: string;
  seriesId?: string;
  dayGap?: number;
}) => {
  const res = await api.post("/assignments", data);
  return res.data;
};

export const listMyAssignmentsService = async (
  params?: { standaloneOnly?: boolean; search?: string; status?: "upcoming" | "live" | "closed"; page?: number; limit?: number }
) => {
  const res = await api.get("/assignments", { params });
  return res.data;
};

export const getAssignmentByIdService = async (id: string) => {
  const res = await api.get(`/assignments/${id}`);
  return res.data;
};

export const updateAssignmentService = async (id: string, data: any) => {
  const res = await api.patch(`/assignments/${id}`, data);
  return res.data;
};

export const extendAssignmentService = async (
  id: string,
  data: { days: number; mode: "grow" | "shift"; cascade: boolean }
) => {
  const res = await api.post(`/assignments/${id}/extend`, data);
  return res.data;
};

export const deleteAssignmentService = async (id: string) => {
  const res = await api.delete(`/assignments/${id}`);
  return res.data;
};

// ------------- QUESTIONS -------------
export const createQuestionService = async (data: {
  assignmentId: string;
  type: "mcq" | "descriptive";
  description: string;
  marks: number;
  modelAnswer?: string;
  options?: { value: string; isCorrect: boolean }[];
}) => {
  const res = await api.post("/assignments/questions", data);
  return res.data;
};

export const updateQuestionService = async (id: string, data: any) => {
  const res = await api.patch(`/assignments/questions/${id}`, data);
  return res.data;
};

export const deleteQuestionService = async (id: string) => {
  const res = await api.delete(`/assignments/questions/${id}`);
  return res.data;
};

export const getQuestionsService = async (assignmentId: string) => {
  const res = await api.get(`/assignments/${assignmentId}/questions`);
  return res.data;
};

// ------------- SUBMISSIONS / GRADING -------------
export const getSubmissionsForAssignmentService = async (
  assignmentId: string,
  params?: { search?: string; page?: number; limit?: number }
) => {
  const res = await api.get(`/assignments/${assignmentId}/submissions`, { params });
  return res.data;
};

export const getSubmissionByIdService = async (submissionId: string) => {
  const res = await api.get(`/assignments/submissions/${submissionId}`);
  return res.data;
};

export const gradeSubmissionService = async (
  submissionId: string,
  data: { answers: { answerId: string; marksAwarded: number; feedback?: string }[]; overallFeedback?: string }
) => {
  const res = await api.post(`/assignments/submissions/${submissionId}/grade`, data);
  return res.data;
};

