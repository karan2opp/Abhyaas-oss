import type { Request, Response } from "express";
import { ApiResponse } from "../../common/utils/ApiResponse.js";
import * as optionsService from "./option.service.js";

export const createOption = async (req: Request, res: Response) => {
    const option = await optionsService.createOption(req.body, req.user!);
    return ApiResponse.ok(res, "Option created successfully", option);
};

export const updateOption = async (req: Request, res: Response) => {
    const option = await optionsService.updateOption(req.params.id as string, req.body, req.user!);
    return ApiResponse.ok(res, "Option updated successfully", option);
};

export const deleteOption = async (req: Request, res: Response) => {
    await optionsService.deleteOption(req.params.id as string, req.user!);
    return ApiResponse.ok(res, "Option deleted successfully", null);
};