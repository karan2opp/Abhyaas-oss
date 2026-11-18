import { Router } from "express";
import * as controller from "./ai_usage.controller.js";
import { authenticate, authorize } from "../../common/middleware/auth.middleware.js";

const router = Router();

// The AI usage page: each teacher sees their own.
router.get("/summary", authenticate, authorize("teacher"), controller.getSummary);
router.get("/logs", authenticate, authorize("teacher"), controller.getLogs);
router.get("/logs/export", authenticate, authorize("teacher"), controller.exportLogs);
router.get("/prices", authenticate, authorize("teacher"), controller.getPrices);

export default router;
