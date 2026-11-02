import { Router } from "express";
import * as controller from "./auth.controller.js";
import validate from "../../common/middleware/validate.middleware.js";
import { authenticate } from "../../common/middleware/auth.middleware.js";
import {
  registerSchema,
  loginSchema,
  verifyOtpSchema,
  resendOtpSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  updateProfileSchema,
} from "./auth.dto.js";
import { upload } from "../../common/middleware/multer.middleware.js";
import { rateLimit } from "express-rate-limit";

const resetPasswordLimiter = rateLimit({
  windowMs: 30 * 60 * 1000, // 30 minutes
  max: 3, // Limit each IP to 3 requests per windowMs
  message: { message: "Too many password reset attempts from this IP, please try again after 30 minutes" },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

const router = Router();

router.post("/register", validate(registerSchema), controller.register);
router.post("/login", validate(loginSchema), controller.login);
router.post("/verify-otp", validate(verifyOtpSchema), controller.verifyOtp);
router.post(
  "/resend-otp",
  resetPasswordLimiter,
  validate(resendOtpSchema),
  controller.resendOtp
);
router.post("/refreshToken", controller.refreshToken);
router.post("/logout", authenticate, controller.logout);
router.post(
  "/forgotPassword",
  resetPasswordLimiter,
  validate(forgotPasswordSchema),
  controller.forgotPassword
);
router.put(
  "/resetPassword",
  resetPasswordLimiter,
  validate(resetPasswordSchema),
  controller.resetPassword
);

router.get("/me", authenticate, controller.getMe);
router.put(
  "/me",
  authenticate,
  upload.single("avatar"),
  validate(updateProfileSchema),
  controller.updateProfile
);

export default router;
