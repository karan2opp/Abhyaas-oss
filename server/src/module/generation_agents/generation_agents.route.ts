import { Router } from "express";
import {
    conversationTurnHandler,
    triggerBlueprintGenerationHandler,
    getBlueprintStatusHandler,
    getConversationHandler,
    blueprintReviewTurnHandler,
    getBlueprintReviewHistoryHandler,
    rebalanceBlueprintHandler,
    triggerQuestionGenerationHandler,
    getQuestionsStatusHandler,
    generateTopicQuestionsHandler,
    questionReviewTurnHandler,
    getQuestionReviewHistoryHandler,
} from "./generation_agents.controller.js";
import {
    createRealtimeSessionHandler,
    executeIntentRealtimeToolHandler,
    executeReviewRealtimeToolHandler,
    executeQuestionReviewRealtimeToolHandler,
    logIntentTurnHandler,
    logReviewTurnHandler,
} from "./realtime_agents.controller.js";
import { authenticate, authorize } from "../../common/middleware/auth.middleware.js";

const router = Router();

router.post(
    "/conversation",
    authenticate,
    authorize("teacher"),
    conversationTurnHandler
);

router.post(
    "/blueprint/generate",
    authenticate,
    authorize("teacher"),
    triggerBlueprintGenerationHandler
);

router.post(
    "/blueprint/rebalance",
    authenticate,
    authorize("teacher"),
    rebalanceBlueprintHandler
);

router.get(
    "/conversation/:sessionId",
    authenticate,
    authorize("teacher"),
    getConversationHandler
);

router.get(
    "/blueprint/:sessionId",
    authenticate,
    authorize("teacher"),
    getBlueprintStatusHandler
);

router.post(
    "/review/turn",
    authenticate,
    authorize("teacher"),
    blueprintReviewTurnHandler
);

router.get(
    "/review/:sessionId",
    authenticate,
    authorize("teacher"),
    getBlueprintReviewHistoryHandler
);

// Text counterpart of /realtime/question-review/tool, for plans without voice.
router.post(
    "/question-review/turn",
    authenticate,
    authorize("teacher"),
    questionReviewTurnHandler
);

router.get(
    "/question-review/:examId",
    authenticate,
    authorize("teacher"),
    getQuestionReviewHistoryHandler
);

router.post(
    "/questions/generate",
    authenticate,
    authorize("teacher"),
    triggerQuestionGenerationHandler
);

router.get(
    "/questions/:sessionId",
    authenticate,
    authorize("teacher"),
    getQuestionsStatusHandler
);

router.post(
    "/topic/generate",
    authenticate,
    authorize("teacher"),
    generateTopicQuestionsHandler
);

router.post(
    "/realtime/session",
    authenticate,
    authorize("teacher"),
    createRealtimeSessionHandler
);

router.post(
    "/realtime/intent/tool",
    authenticate,
    authorize("teacher"),
    executeIntentRealtimeToolHandler
);

router.post(
    "/realtime/review/tool",
    authenticate,
    authorize("teacher"),
    executeReviewRealtimeToolHandler
);

router.post(
    "/realtime/question-review/tool",
    authenticate,
    authorize("teacher"),
    executeQuestionReviewRealtimeToolHandler
);

router.post(
    "/realtime/intent/log",
    authenticate,
    authorize("teacher"),
    logIntentTurnHandler
);

router.post(
    "/realtime/review/log",
    authenticate,
    authorize("teacher"),
    logReviewTurnHandler
);

export const generationAgentsRouter = router;
export default router;
