import { ApiResponse } from "../../common/utils/ApiResponse.js";
import * as answerService from "./answer.service.js"
import type { Request, Response } from "express"
const submitAnswer = async (req: Request, res: Response) => {
    const answer = await answerService.submitAnswer(req.body, req.user?.id as string)
    ApiResponse.created(res, "Answer submitted successfully", answer)
}

export { submitAnswer }