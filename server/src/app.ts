import express from "express";
import { clerkMiddleware } from "@clerk/express";
import cors from "cors";
import { serve } from "inngest/express";
import authRoutes from "./module/auth/auth.route.js";
import plansRouter from "./module/plans/plan.route.js";
import paymentsRouter, { paymentWebhook } from "./module/payments/payment.route.js";
import aiKeyRouter from "./module/ai_keys/ai_key.route.js";
import assignmentsRouter from "./module/assignments/assignment.route.js";
import examRouter from "./module/exam/exam.route.js";
import sectionsRouter from "./module/sections/section.routes.js";
import questionsRouter from "./module/questions/question.route.js";
import optionsRouter from "./module/options/option.route.js";
import submissionsRouter from "./module/submissions/submission.route.js";
import answersRouter from "./module/answers/answer.route.js";
import feedbackRouter from "./module/feedback/feedback.route.js";
import jobsRouter from "./module/jobs/jobs.route.js";
import speechRouter from "./module/speech/speech.route.js";
import generationAgentsRouter from "./module/generation_agents/generation_agents.route.js";
import { inngest } from "./common/inngest/client.js";
import { generationAgentFunctions } from "./module/generation_agents/inngest/functions.js";
import questionBankRouter from "./module/question_bank/question_bank.route.js";
import { questionBankFunctions } from "./module/question_bank/inngest/functions.js";
import bookRouter from "./module/books/book.route.js";
import { bookFunctions } from "./module/books/inngest/functions.js";
import { rubricFunctions } from "./module/rubrics/inngest/functions.js";
import errorHandler from "./common/middleware/error.middleware.js";
import 'dotenv/config'
const app = express();

// Behind Render's proxy: without this every visitor looks like the same IP, so the rate limiters (and anything else
// that reads the client's address) would treat all users as one.
app.set("trust proxy", 1);

// For the host's health check. Deliberately cheap and open: no login, no database call, so a database hiccup doesn't
// make the host restart a server that is otherwise fine.
app.get("/health", (_req, res) => {
    res.status(200).json({ ok: true });
});

// FRONTEND_URL can list several addresses separated by commas (e.g. localhost for the laptop plus the LAN address for a
// phone). Both the CORS check below and Clerk's allowed-origin check use the same list.
const frontendUrls = (process.env.FRONTEND_URL || "http://localhost:3001").split(",").map((url) => url.trim()).filter(Boolean);

app.use(cors({
    origin: frontendUrls,
    credentials: true,
}));

// Inngest sends the results of every completed step with each call, so a long job (a whole book) quickly
// outgrows the 100 KB default body limit. Registered before the global parser so this limit applies.
app.use("/api/inngest", express.json({ limit: "50mb" }), serve({ client: inngest, functions: [...generationAgentFunctions, ...questionBankFunctions, ...bookFunctions, ...rubricFunctions] }));

// Cashfree's payment webhook. It has to come before the JSON parser below: its signature is checked against the exact raw
// bytes of the request, which the parser would otherwise consume. It needs no sign-in (Cashfree calls it, not a person).
app.post("/api/payments/webhook", ...paymentWebhook);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Checks the Clerk session token the website sends in the Authorization header. It needs CLERK_SECRET_KEY and the
// publishable key in the environment. The publishable key is public and is often saved under the website's name for it
// (NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY), so either name works. Routes that need a signed-in user use `authenticate`
// (auth.middleware.ts).
const clerkPublishableKey = process.env.CLERK_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
app.use(
    clerkMiddleware({
        ...(clerkPublishableKey ? { publishableKey: clerkPublishableKey } : {}),
        authorizedParties: frontendUrls,
    })
);

app.use("/api/auth", authRoutes);
app.use("/api/plans", plansRouter);
app.use("/api/payments", paymentsRouter);
app.use("/api/ai-key", aiKeyRouter);
app.use("/api/assignments", assignmentsRouter)
app.use("/api/exams", examRouter)
app.use("/api/sections", sectionsRouter)
app.use("/api/questions", questionsRouter)
app.use("/api/options", optionsRouter)
app.use("/api/submissions", submissionsRouter)
app.use("/api/answers", answersRouter)
app.use("/api/feedback", feedbackRouter)
app.use("/api/generation-agents", generationAgentsRouter);
app.use("/api/question-bank", questionBankRouter);
app.use("/api/books", bookRouter);
app.use("/api/jobs", jobsRouter);
app.use("/api/speech", speechRouter);
app.use(errorHandler)

export default app;

// Trigger restart