import type { Request, Response } from "express";
import { ApiResponse } from "../../common/utils/ApiResponse.js";
import * as sectionsService from "./sections.service.js";

export const createSection = async (req: Request, res: Response) => {
    const section = await sectionsService.createSection(req.body, req.user!);
    return ApiResponse.ok(res, "Section created successfully", section);
};

export const getSectionsByExam = async (req: Request, res: Response) => {
    const sections = await sectionsService.getSectionsByExam(req.params.examId as string, req.user!);
    return ApiResponse.ok(res, "Sections fetched successfully", sections);
};

export const getSectionsWithDetails = async (req: Request, res: Response) => {
    const sections = await sectionsService.getSectionsWithDetails(req.params.examId as string, req.user!);
    return ApiResponse.ok(res, "Sections with details fetched successfully", sections);
};

export const updateSection = async (req: Request, res: Response) => {
    const section = await sectionsService.updateSection(req.params.id as string, req.body, req.user!);
    return ApiResponse.ok(res, "Section updated successfully", section);
};

export const deleteSection = async (req: Request, res: Response) => {
    await sectionsService.deleteSection(req.params.id as string, req.user!);
    return ApiResponse.ok(res, "Section deleted successfully", null);
};