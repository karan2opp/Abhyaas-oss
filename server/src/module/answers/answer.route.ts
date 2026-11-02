import { Router } from "express";
import { submitAnswer } from "./answer.controller.js";
import validate from "../../common/middleware/validate.middleware.js";
import { createAnswerSchema } from "./dto/answer.dto.js";
import { authenticate } from "../../common/middleware/auth.middleware.js";

const router = Router();

router.post("/", authenticate, validate(createAnswerSchema), submitAnswer);
export default router;