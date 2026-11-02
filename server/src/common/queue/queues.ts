import { Queue } from "bullmq";
import { env } from "../../env.js";

const connection = { url: env.REDIS_URL };

export const evaluationQueue = new Queue<{ submissionId: string; mode: string }>("evaluation", { connection });
