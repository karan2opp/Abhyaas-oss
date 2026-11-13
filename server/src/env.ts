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
  // How many student answers may be with OpenAI for grading at the same moment, across all submissions. Keeps a rush of
  // submissions from running into OpenAI's rate limits; the rest simply wait their turn.
  EVAL_AI_CONCURRENCY: z.coerce.number().int().min(1).default(6),
  REALTIME_MODEL: z.string().default("gpt-realtime"),
  REALTIME_VOICE: z.string().default("marin"),
  PDF_VISION_MODEL: z.string().default("gpt-4.1-mini"),
  EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),
  // Speech-to-text for the mic button in the chats.
  TRANSCRIPTION_MODEL: z.string().default("gpt-4o-mini-transcribe"),

  // Who pays for AI. "byok" (bring your own key): each person adds their own OpenAI key and their AI use is billed to
  // it; the server's OPENAI_API_KEY is never used for them. "server": the older behaviour, where everything runs on the
  // server's own key (and the plans and quotas apply).
  AI_KEY_MODE: z.enum(["byok", "server"]).default("byok"),
  // Encrypts the keys people save. 32 random bytes as base64:
  //   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
  // Keep it secret and never change it while keys are saved (they could no longer be read). Production needs its own.
  AI_KEY_ENCRYPTION_SECRET: z.string().default(""),

  // Cashfree (payments). Left empty, online payments are simply "not set up" and everything else works. Start with the
  // sandbox keys (CASHFREE_ENV=sandbox); switch to production only with live keys.
  CASHFREE_APP_ID: z.string().default(""),
  CASHFREE_SECRET_KEY: z.string().default(""),
  CASHFREE_ENV: z.enum(["sandbox", "production"]).default("sandbox"),
  // The public https address Cashfree calls when a payment succeeds, e.g. https://your-domain/api/payments/webhook.
  // Optional: the same address can be saved in the Cashfree dashboard (Developers > Webhooks) instead.
  CASHFREE_WEBHOOK_URL: z.string().default(""),
});

function createEnv(env: NodeJS.ProcessEnv) {
  const safeParseResult = envSchema.safeParse(env);
  if (!safeParseResult.success) throw new Error(safeParseResult.error.message);
  return safeParseResult.data;
}
export const env = createEnv(process.env);
