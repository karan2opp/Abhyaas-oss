import type { Request, Response } from "express";
import { ApiResponse } from "../../common/utils/ApiResponse.js";
import * as examService from "./exam.service.js";
import { addTopicToExam, removeTopicFromExam } from "./exam_topics.service.js";

const toRequester = (req: Request) => ({
    id: req.user!.id,
    role: req.user!.role,
});

export const createExam = async (req: Request, res: Response) => {
    const exam = await examService.createExam(req.body, toRequester(req));
    return ApiResponse.created(res, "Exam created successfully", exam);
};

export const saveGeneratedExam = async (req: Request, res: Response) => {
    const exam = await examService.saveGeneratedExam(req.body, toRequester(req));
    return ApiResponse.created(res, "Generated exam saved successfully", exam);
};

export const getExams = async (req: Request, res: Response) => {
    const { search, days, page, limit, status } = req.query;
    const examsData = await examService.getExams(
        req.user!.id,
        search as string,
        days as string,
        Number(page) || 1,
        Number(limit) || 10,
        status as string | undefined
    );
    return ApiResponse.ok(res, "Exams fetched successfully", examsData);
};

export const getExamById = async (req: Request, res: Response) => {
    const exam = await examService.getExamById(req.params.id as string, toRequester(req));
    return ApiResponse.ok(res, "Exam fetched successfully", exam);
};

export const updateExam = async (req: Request, res: Response) => {
    const exam = await examService.updateExam(req.params.id as string, req.body, toRequester(req));
    return ApiResponse.ok(res, "Exam updated successfully", exam);
};

export const deleteExam = async (req: Request, res: Response) => {
    await examService.deleteExam(req.params.id as string, toRequester(req));
    return ApiResponse.ok(res, "Exam deleted successfully", null);
};

export const getOverviewStats = async (req: Request, res: Response) => {
    const stats = await examService.getOverviewStats(req.user!.id);
    return ApiResponse.ok(res, "Overview stats fetched successfully", stats);
};

export const getMyExams = async (req: Request, res: Response) => {
    const exams = await examService.getMyExams(
        req.user!.id,
        req.query.search as string | undefined,
        req.query.category as string | undefined,
        Number(req.query.page) || 1,
        Number(req.query.limit) || 10
    );
    return ApiResponse.ok(res, "Your exams", exams);
};

export const addTopic = async (req: Request, res: Response) => {
    const result = await addTopicToExam(req.params.id as string, req.body, toRequester(req));
    return ApiResponse.ok(res, "Topic added", result);
};

export const removeTopic = async (req: Request, res: Response) => {
    const result = await removeTopicFromExam(req.params.id as string, req.body, toRequester(req));
    return ApiResponse.ok(res, "Topic removed", result);
};
