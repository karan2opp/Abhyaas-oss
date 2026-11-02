import type { Request, Response } from "express";
import { ApiResponse } from "../../common/utils/ApiResponse.js";
import * as questionsService from "./question.service.js";

export const createQuestion = async (req: Request, res: Response) => {
    const files = req.files as Express.Multer.File[] | undefined;
    const question = await questionsService.createQuestion(req.body, req.user!, files);
    return ApiResponse.ok(res, "Question created successfully", question);
};

export const getQuestionsBySection = async (req: Request, res: Response) => {
    const questions = await questionsService.getQuestionsBySection(req.params.sectionId as string, req.user!);
    return ApiResponse.ok(res, "Questions fetched successfully", questions);
};

export const getQuestionById = async (req: Request, res: Response) => {
    const question = await questionsService.getQuestionById(req.params.id as string, req.user!);
    return ApiResponse.ok(res, "Question fetched successfully", question);
};

export const updateQuestion = async (req: Request, res: Response) => {
    const files = req.files as Express.Multer.File[] | undefined;
    const question = await questionsService.updateQuestion(req.params.id as string, req.body, req.user!, files);
    return ApiResponse.ok(res, "Question updated successfully", question);
};

export const deleteQuestion = async (req: Request, res: Response) => {
    await questionsService.deleteQuestion(req.params.id as string, req.user!);
    return ApiResponse.ok(res, "Question deleted successfully", null);
};
