import { Router } from "express";
import { authenticate, authorize } from "../../common/middleware/auth.middleware.js";
import validate from "../../common/middleware/validate.middleware.js";
import { createFeedbackSchema } from "./dto/feedback.dto.js";
import * as feedbackController from "./feedback.controller.js";

const router = Router();

router.post(
  "/",
  authenticate,
  authorize("student"),
  validate(createFeedbackSchema),
  feedbackController.createFeedback
);

export default router;
