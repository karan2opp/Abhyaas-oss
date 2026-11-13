import { Router } from "express";
import * as controller from "./auth.controller.js";
import validate from "../../common/middleware/validate.middleware.js";
import { authenticate, authenticateAllowingOnboarding } from "../../common/middleware/auth.middleware.js";
import { updateProfileSchema, roleSchema } from "./auth.dto.js";
import { upload } from "../../common/middleware/multer.middleware.js";

// Signing up, signing in, email codes and password reset are all handled by Clerk, so none of those routes exist here.
const router = Router();

router.get("/me", authenticateAllowingOnboarding, controller.getMe);
// The first-time question: start as a student or a teacher.
router.post("/onboard", authenticateAllowingOnboarding, validate(roleSchema), controller.onboard);
// Switch between student and teacher at any time (the sidebar toggle).
router.put("/role", authenticate, validate(roleSchema), controller.switchRole);
router.put(
  "/me",
  authenticate,
  upload.single("avatar"),
  validate(updateProfileSchema),
  controller.updateProfile
);

export default router;
