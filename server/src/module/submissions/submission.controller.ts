import type { Request, Response } from "express";
import { ApiResponse } from "../../common/utils/ApiResponse.js";
import * as submissionsService from "./submission.service.js";

const toRequester = (req: Request) => ({
    id: req.user!.id,
    role: req.user!.role,
});

export const joinExam = async (req: Request, res: Response) => {
    const result = await submissionsService.joinExam(req.body.joinCode, req.user!.id);
    return ApiResponse.ok(res, "Exam joined successfully", result);
};

export const submitExam = async (req: Request, res: Response) => {
    const result = await submissionsService.submitExam(req.params.id as string, req.user!.id, req.body?.mode as string);
    return ApiResponse.ok(res, "Exam submitted successfully", result);
};

export const gradeExamSubmission = async (req: Request, res: Response) => {
    const result = await submissionsService.gradeExamSubmission(req.params.id as string, req.body, toRequester(req));
    return ApiResponse.ok(res, "Submission graded successfully", result);
};

export const evaluateSubmissionWithAI = async (req: Request, res: Response) => {
    const result = await submissionsService.evaluateSubmissionWithAI(req.params.id as string, req.body, toRequester(req));
    return ApiResponse.ok(res, "AI evaluation complete", result);
};

export const getSubmissionById = async (req: Request, res: Response) => {
    const mode = (req.query.mode as string) || "detailed";
    const submission = await submissionsService.getSubmissionById(req.params.id as string, toRequester(req), mode);
    return ApiResponse.ok(res, "Submission fetched successfully", submission);
};

export const getSubmissionsByExam = async (req: Request, res: Response) => {
    const mode = (req.query.mode as string) || "simple";
    const submissions = await submissionsService.getSubmissionsByExam(req.params.examId as string, toRequester(req), mode);
    return ApiResponse.ok(res, "Submissions fetched successfully", submissions);
};

export const deleteSubmission = async (req: Request, res: Response) => {
    await submissionsService.deleteSubmission(req.params.id as string, req.user!.id);
    return ApiResponse.ok(res, "Submission deleted successfully", null);
};

export const getUpcomingExams = async (req: Request, res: Response) => {
    const result = await submissionsService.getUpcomingExams(req.user!.id);
    return ApiResponse.ok(res, "Upcoming exams fetched", result);
};

export const getMySubmissions = async (req: Request, res: Response) => {
    const mode = (req.query.mode as string) || "simple";
    const { search, days, page, limit } = req.query;
    const submissionsData = await submissionsService.getMySubmissions(
        req.user!.id,
        mode,
        search as string,
        days as string,
        Number(page) || 1,
        Number(limit) || 10
    );
    return ApiResponse.ok(res, "My submissions fetched successfully", submissionsData);
};

export const getExamForSubmission = async (req: Request, res: Response) => {
    const examData = await submissionsService.getExamForSubmission(req.params.id as string, toRequester(req));
    return ApiResponse.ok(res, "Exam data fetched successfully", examData);
};

export const verifyJoinCode = async (req: Request, res: Response) => {
    const exam = await submissionsService.verifyJoinCode(req.params.joinCode as string, req.user!.id);
    return ApiResponse.ok(res, "Join code verified successfully", exam);
};

export const getExamLeaderboard = async (req: Request, res: Response) => {
    const leaderboard = await submissionsService.getExamLeaderboard(req.params.examId as string, toRequester(req));
    return ApiResponse.ok(res, "Leaderboard fetched successfully", leaderboard);
};
