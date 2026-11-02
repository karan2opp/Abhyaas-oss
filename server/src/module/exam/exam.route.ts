import { Router } from "express";
import * as controller from "./exam.controller.js";
import validate from "../../common/middleware/validate.middleware.js";
import { authenticate, authorize } from "../../common/middleware/auth.middleware.js";
import { createExamSchema, updateExamSchema } from "./dto/exam.dto.js";

const router = Router();

router.post("/", authenticate, authorize("teacher"), validate(createExamSchema), controller.createExam);
router.post("/save-generated", authenticate, authorize("teacher"), controller.saveGeneratedExam);
router.get("/overview/stats", authenticate, authorize("teacher"), controller.getOverviewStats);
router.get("/", authenticate, authorize("teacher"), controller.getExams);
router.get("/me", authenticate, authorize("student"), controller.getMyExams);
router.get("/:id", authenticate, authorize("teacher"), controller.getExamById);
router.post("/:id/topics", authenticate, authorize("teacher"), controller.addTopic);
router.post("/:id/topics/remove", authenticate, authorize("teacher"), controller.removeTopic);
router.patch("/:id", authenticate, authorize("teacher"), validate(updateExamSchema), controller.updateExam);
router.delete("/:id", authenticate, authorize("teacher"), controller.deleteExam);

export default router;
