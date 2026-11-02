import bcrypt from "bcrypt";
import { eq, and, gt, isNotNull } from "drizzle-orm";
import db from "../../common/db/index.js";
import { users } from "../../common/db/schema.js";
import { ApiError } from "../../common/utils/ApiError.js";
import { sendVerificationEmail, sendResetPasswordEmail } from "../../common/config/email.js";
import {
    generateAccessToken,
    generateRefreshToken,
    generateResetToken,
    generateOTP,
    verifyRefreshToken,
    hashToken,
} from "../../common/utils/jwt.utils.js";
import type { RegisterDto, LoginDto, VerifyOtpDto } from "./auth.dto.js";

// ── Register ──────────────────────────────────────────────────────────────────
const register = async (data: RegisterDto) => {
    const [existing] = await db.select().from(users).where(eq(users.email, data.email));
    if (existing) throw ApiError.conflict("User already exists");

    const hashedPassword = await bcrypt.hash(data.password, 12);
    const { rawToken, hashedToken } = generateOTP();

    const [newUser] = await db.insert(users).values({
        ...data,
        password: hashedPassword,
        verificationToken: hashedToken,
        verificationExpires: new Date(Date.now() + 15 * 60 * 1000), // 15 mins
        isVerified: false,
    }).returning();

    try {
        await sendVerificationEmail(data.email, rawToken)
    } catch (err) {
        console.error("Failed to send verification email:", err)
    }
    if (!newUser) throw ApiError.internal("Failed to create user");

    const { password, verificationToken, refreshToken, ...safeUser } = newUser;
    return safeUser;
};

// ── Login ─────────────────────────────────────────────────────────────────────
const login = async (data: LoginDto) => {
    const [existing] = await db.select().from(users).where(eq(users.email, data.email));
    if (!existing) throw ApiError.unauthorized("Invalid email or password");

    const isPasswordValid = await bcrypt.compare(data.password, existing.password);
    if (!isPasswordValid) throw ApiError.unauthorized("Invalid email or password");

    if (!existing.isVerified) throw ApiError.unauthorized("Please verify your email first");

    const accessToken = generateAccessToken({ id: existing.id, role: existing.role });
    const refreshToken = generateRefreshToken({ id: existing.id });

    await db.update(users)
        .set({ refreshToken: hashToken(refreshToken) })
        .where(eq(users.id, existing.id));

    // reuse existing, no need for extra DB call
    const { password, verificationToken, refreshToken: _, resetPasswordToken, resetPasswordExpires, ...safeUser } = existing;
    return { accessToken, refreshToken, safeUser };
};

// ── Logout ────────────────────────────────────────────────────────────────────
const logout = async (userId: string) => {
    await db.update(users)
        .set({ refreshToken: null })
        .where(eq(users.id, userId));
};

// ── Verify OTP ──────────────────────────────────────────────────────────────
const verifyOtp = async (data: VerifyOtpDto) => {
    const hashedInput = hashToken(data.otp);
    
    const [user] = await db.select().from(users).where(
        and(
            eq(users.email, data.email),
            eq(users.verificationToken, hashedInput),
            isNotNull(users.verificationExpires),
            gt(users.verificationExpires!, new Date()),
        )
    );

    if (!user) throw ApiError.badRequest("Invalid or expired verification code");

    const [updatedUser] = await db.update(users)
        .set({ isVerified: true, verificationToken: null, verificationExpires: null })
        .where(eq(users.id, user.id))
        .returning();

    return updatedUser;
};

// ── Resend verification OTP ───────────────────────────────────────────────
const resendOtp = async (email: string) => {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    if (!user) throw ApiError.notFound("No account with that email");
    if (user.isVerified) throw ApiError.badRequest("This account is already verified");

    const { rawToken, hashedToken } = generateOTP();

    await db.update(users)
        .set({
            verificationToken: hashedToken,
            verificationExpires: new Date(Date.now() + 15 * 60 * 1000),
        })
        .where(eq(users.id, user.id));

    try {
        await sendVerificationEmail(email, rawToken);
    } catch (err) {
        console.error("Failed to send verification email:", err);
    }
};

// ── Forgot password ───────────────────────────────────────────────────────────
const forgotPassword = async (email: string) => {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    if (!user) throw ApiError.notFound("No account with that email");

    const { rawToken, hashedToken } = generateOTP();

    await db.update(users)
        .set({
            resetPasswordToken: hashedToken,
            resetPasswordExpires: new Date(Date.now() + 15 * 60 * 1000),
        })
        .where(eq(users.id, user.id));

    try {
        await sendResetPasswordEmail(email, rawToken);
    } catch (err: unknown) {
        console.error("Failed to send reset email:", (err as Error).message);
    }
};

// ── Reset password ────────────────────────────────────────────────────────────
const resetPassword = async (email: string, otp: string, newPassword: string) => {
    const hashedToken = hashToken(otp);

    const [user] = await db.select().from(users).where(
        and(
            eq(users.email, email),
            eq(users.resetPasswordToken, hashedToken),
            isNotNull(users.resetPasswordExpires),
            gt(users.resetPasswordExpires!, new Date()),
        ),
    );

    if (!user) throw ApiError.badRequest("Invalid or expired reset code");

    const hashedPassword = await bcrypt.hash(newPassword, 12);

    await db.update(users)
        .set({
            password: hashedPassword,
            resetPasswordToken: null,
            resetPasswordExpires: null,
        })
        .where(eq(users.id, user.id));
};

// ── Refresh token ─────────────────────────────────────────────────────────────
const refresh = async (token: string) => {
    if (!token) throw ApiError.unauthorized("Refresh token missing");

    const decoded = verifyRefreshToken(token) as { id: string };

    const [user] = await db.select().from(users).where(eq(users.id, decoded.id));
    if (!user) throw ApiError.unauthorized("User no longer exists");

    if (user.refreshToken !== hashToken(token)) {
        throw ApiError.unauthorized("Invalid refresh token — please log in again");
    }

    const accessToken = generateAccessToken({ id: user.id, role: user.role });
    return { accessToken };
};

// ── Get me ────────────────────────────────────────────────────────────────────
const getMe = async (userId: string) => {
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user) throw ApiError.notFound("User not found");

    const { password, verificationToken, refreshToken, resetPasswordToken, resetPasswordExpires, ...safeUser } = user;
    return safeUser;
};

// ── Update Profile ────────────────────────────────────────────────────────────
const updateProfile = async (userId: string, data: { phone?: string, name?: string }, file?: Express.Multer.File) => {
    const updateData: Partial<typeof users.$inferInsert> = {};

    if (data.phone !== undefined) {
        updateData.phone = data.phone;
    }
    
    if (data.name !== undefined) {
        updateData.name = data.name;
    }

    if (file) {
        const { uploadToCloudinary } = await import("../../common/config/cloudinary.js");
        const uploadResult = await uploadToCloudinary(file.buffer, "abiyaas/avatars");
        updateData.avatarUrl = uploadResult.url;
        updateData.avatarPublicId = uploadResult.publicId;
    }

    if (Object.keys(updateData).length === 0) {
        return getMe(userId);
    }

    const [updatedUser] = await db.update(users)
        .set({ ...updateData, updatedAt: new Date() })
        .where(eq(users.id, userId))
        .returning();

    if (!updatedUser) throw ApiError.notFound("User not found during update");

    const { password, verificationToken, refreshToken, resetPasswordToken, resetPasswordExpires, ...safeUser } = updatedUser;
    return safeUser;
};

export { register, login, logout, verifyOtp, resendOtp, forgotPassword, resetPassword, refresh, getMe, updateProfile };