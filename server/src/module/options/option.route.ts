import { Router } from "express";
import * as controller from "./option.controller.js";
import validate from "../../common/middleware/validate.middleware.js";
import { authenticate, authorize } from "../../common/middleware/auth.middleware.js";
import { createOptionSchema, updateOptionSchema } from "./dto/option.dto.js";

const router = Router();

router.post("/", authenticate, authorize("teacher"), validate(createOptionSchema), controller.createOption);
router.patch("/:id", authenticate, authorize("teacher"), validate(updateOptionSchema), controller.updateOption);
router.delete("/:id", authenticate, authorize("teacher"), controller.deleteOption);

export default router;