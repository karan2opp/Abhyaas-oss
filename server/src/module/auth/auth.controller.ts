import type { Request, Response } from "express";
import { ApiResponse } from "../../common/utils/ApiResponse.js";
import * as authService from "./auth.service.js";

export const getMe = async (req: Request, res: Response) => {
    const user = await authService.getMe(req.user!.id);
    return ApiResponse.ok(res, "User profile", user);
};

export const onboard = async (req: Request, res: Response) => {
    const user = await authService.onboard(req.user!.id, req.body);
    return ApiResponse.ok(res, "Role saved", user);
};

export const updateProfile = async (req: Request, res: Response) => {
    const user = await authService.updateProfile(req.user!.id, req.body, req.file);
    return ApiResponse.ok(res, "Profile updated successfully", user);
};

export const switchRole = async (req: Request, res: Response) => {
    const user = await authService.switchRole(req.user!.id, req.body);
    return ApiResponse.ok(res, "Role changed", user);
};
