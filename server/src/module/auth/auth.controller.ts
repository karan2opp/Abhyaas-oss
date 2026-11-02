import type { Request, Response } from "express";
import { ApiResponse } from "../../common/utils/ApiResponse.js";
import * as authService from "./auth.service.js";

export const register = async (req: Request, res: Response) => {
    const result = await authService.register(req.body);
    return ApiResponse.ok(res, "User registered successfully", result);
};

export const login = async (req: Request, res: Response) => {
    const result = await authService.login(req.body)

    res.cookie("refreshToken", result.refreshToken, {
        httpOnly: true,
        secure: true,
        sameSite: "none",  // ← change this
        maxAge: 7 * 24 * 60 * 60 * 1000
    })
    return ApiResponse.ok(res, "User logged in successfully", { accessToken: result.accessToken, user: result.safeUser })
}
export const logout = async (req: Request, res: Response) => {
    const result = await authService.logout(req.user!.id)

    // Must match the attributes the cookie was set with (see login). A browser ignores a "strict" cookie sent in a reply
    // to a request from another site, so with the site and the API on different domains this would not log anyone out.
    res.clearCookie("refreshToken", {
        httpOnly: true,
        secure: true,
        sameSite: "none",
    });
    return ApiResponse.ok(res, "User logged out successfully", result)
}

export const verifyOtp = async (req: Request, res: Response) => {
    await authService.verifyOtp(req.body);
    return ApiResponse.ok(res, "Email verified successfully", null);
};

export const resendOtp = async (req: Request, res: Response) => {
    await authService.resendOtp(req.body.email);
    return ApiResponse.ok(res, "Verification code sent to your email", null);
};

export const refreshToken = async (req: Request, res: Response) => {
    const token = req.cookies?.refreshToken;
    const { accessToken } = await authService.refresh(token);
    return ApiResponse.ok(res, "Token refreshed", { accessToken });
};

export const forgotPassword = async (req: Request, res: Response) => {
    await authService.forgotPassword(req.body.email);
    return ApiResponse.ok(res, "Password reset email sent", null);
};

export const resetPassword = async (req: Request, res: Response) => {
    const { email, otp, password } = req.body;
    await authService.resetPassword(email, otp, password);
    return ApiResponse.ok(res, "Password reset successful", null);
};

export const getMe = async (req: Request, res: Response) => {
    const user = await authService.getMe(req.user!.id);
    return ApiResponse.ok(res, "User profile", user);
};

export const updateProfile = async (req: Request, res: Response) => {
    const user = await authService.updateProfile(req.user!.id, req.body, req.file);
    return ApiResponse.ok(res, "Profile updated successfully", user);
};