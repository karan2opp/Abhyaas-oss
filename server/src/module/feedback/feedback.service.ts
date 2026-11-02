import { and, eq } from "drizzle-orm";
import db from "../../common/db/index.js";
import { feedbacks } from "./feedback.schema.js";
import { submissions } from "../submissions/submission.schema.js";
import { ApiError } from "../../common/utils/ApiError.js";
import type { CreateFeedbackDto } from "./dto/feedback.dto.js";

export const createFeedback = async (studentId: string, data: CreateFeedbackDto) => {
  const [submission] = await db
    .select()
    .from(submissions)
    .where(
      and(
        eq(submissions.id, data.submissionId),
        eq(submissions.userId, studentId),
        eq(submissions.examId, data.examId)
      )
    )
    .limit(1);

  if (!submission) {
    throw ApiError.forbidden("Submission not found or does not belong to you");
  }

  const [newFeedback] = await db
    .insert(feedbacks)
    .values({
      examId: data.examId,
      studentId: studentId,
      submissionId: data.submissionId,
      experienceRating: data.experienceRating,
      experienceText: data.experienceText,
      aiEvaluationRating: data.aiEvaluationRating,
      aiEvaluationText: data.aiEvaluationText,
    })
    .returning();

  return newFeedback;
};
