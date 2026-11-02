import api from "@/utils/axios";

export const getMyAssignmentsService = async () => {
  const res = await api.get("/assignments/me");
  return res.data;
};

export const getAssignmentByIdService = async (id: string) => {
  const res = await api.get(`/assignments/${id}`);
  return res.data;
};

export const getQuestionsService = async (assignmentId: string) => {
  const res = await api.get(`/assignments/${assignmentId}/questions`);
  return res.data;
};

export const startAssignmentService = async (assignmentId: string) => {
  const res = await api.post(`/assignments/${assignmentId}/start`);
  return res.data;
};

export const saveAnswerService = async (data: {
  submissionId: string;
  questionId: string;
  options?: string[];
  textAnswer?: string;
}) => {
  const res = await api.post("/assignments/answers", data);
  return res.data;
};

export const submitAssignmentService = async (submissionId: string) => {
  const res = await api.patch(`/assignments/submissions/${submissionId}/submit`);
  return res.data;
};

export const getMySubmissionService = async (assignmentId: string) => {
  const res = await api.get(`/assignments/${assignmentId}/my-submission`);
  return res.data;
};

// The code can belong to a single assignment or a whole series.
export const joinAssignmentByCodeService = async (joinCode: string) => {
  const res = await api.post("/assignments/join", { joinCode });
  return res.data;
};
