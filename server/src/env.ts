import { z } from "zod";
import "dotenv/config";
const envSchema = z.object({
  // 8000, not 3000 — 3000 is the Next dev server's port, so the old default
  // collided with the client whenever PORT wasn't set explicitly.
  PORT: z.string().default("8000").transform((val) => parseInt(val, 10)),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  GENERATION_MODEL: z.string().default("gpt-5.6-luna"),
  // The Exam Intent chat only asks a few short questions, so it runs on a cheaper, faster model than question writing.
  INTENT_MODEL: z.string().default("gpt-5.6-luna"),
  EVALUATION_MODEL: z.string().default("gpt-4.1-mini"),
  GUARDRAIL_MODEL: z.string().default("gpt-4.1-mini"),
  REALTIME_MODEL: z.string().default("gpt-realtime"),
  REALTIME_VOICE: z.string().default("marin"),
  PDF_VISION_MODEL: z.string().default("gpt-4.1-mini"),
  EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),
  // Speech-to-text for the mic button in the chats.
  TRANSCRIPTION_MODEL: z.string().default("gpt-4o-mini-transcribe"),
});

function createEnv(env: NodeJS.ProcessEnv) {
  const safeParseResult = envSchema.safeParse(env);
  if (!safeParseResult.success) throw new Error(safeParseResult.error.message);
  return safeParseResult.data;
}
export const env = createEnv(process.env);
