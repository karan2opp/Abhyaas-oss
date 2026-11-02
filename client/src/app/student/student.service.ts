import api from "@/utils/axios";

export const joinExamService = async (joinCode: string) => {
  const res = await api.post("/submissions/join", { joinCode });
  return res.data;
};

export const getMyExamsService = async (page?: number, limit?: number, search?: string, category?: string) => {
  const res = await api.get("/exams/me", { params: { page, limit, search, category } });
  return res.data;
};

export const verifyJoinCodeService = async (joinCode: string) => {
  const res = await api.get(`/submissions/verify/${joinCode}`);
  return res.data;
};

// Exams the student has entered the join code for but not started yet.
export const getUpcomingExamsService = async () => {
  const res = await api.get("/submissions/upcoming");
  return res.data;
};

export const getMySubmissionsService = async (params?: { page?: number, limit?: number, search?: string, days?: string }) => {
  const res = await api.get("/submissions/me", { params });
  return res.data;
};

export const getExamForSubmissionService = async (id: string) => {
  const res = await api.get(`/submissions/${id}/exam`);
  return res.data;
};

export const submitAnswerService = async (data: any) => {
  const res = await api.post("/answers", data, { timeout: 60000 });
  return res.data;
};

export const submitExamService = async (id: string) => {
  const res = await api.patch(`/submissions/${id}/submit`, undefined, { timeout: 60000 });
  return res.data;
};

export const getSubmissionByIdService = async (id: string) => {
  const res = await api.get(`/submissions/${id}`);
  return res.data;
};

export const getExamLeaderboardService = async (examId: string) => {
  const res = await api.get(`/submissions/exam/${examId}/leaderboard`);
  return res.data;
};

export const submitFeedbackService = async (data: any) => {
  const res = await api.post("/feedback", data);
  return res.data;
};
