import type { Request, Response } from "express";
import { ApiResponse } from "../../common/utils/ApiResponse.js";
import * as feedbackService from "./feedback.service.js";

export const createFeedback = async (req: Request, res: Response) => {
  const feedback = await feedbackService.createFeedback(req.user!.id, req.body);
  return ApiResponse.created(res, "Feedback submitted successfully", feedback);
};
