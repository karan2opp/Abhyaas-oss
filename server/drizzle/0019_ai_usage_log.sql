CREATE TABLE IF NOT EXISTS "ai_usage_log" (
  "id" text PRIMARY KEY NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "organisation_id" text,
  "user_id" text,
  "exam_id" text,
  "assignment_id" text,
  "purpose" text NOT NULL,
  "model" text NOT NULL,
  "input_tokens" integer DEFAULT 0 NOT NULL,
  "cached_input_tokens" integer DEFAULT 0 NOT NULL,
  "output_tokens" integer DEFAULT 0 NOT NULL,
  "reasoning_tokens" integer DEFAULT 0 NOT NULL,
  "cost_usd" double precision DEFAULT 0 NOT NULL,
  "price_missing" boolean DEFAULT false NOT NULL,
  "success" boolean DEFAULT true NOT NULL,
  "error" text,
  "duration_ms" integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "model_prices" (
  "model" text PRIMARY KEY NOT NULL,
  "input_per_million" double precision NOT NULL,
  "cached_input_per_million" double precision NOT NULL,
  "output_per_million" double precision NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_usage_log_org_created_idx" ON "ai_usage_log" ("organisation_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_usage_log_exam_idx" ON "ai_usage_log" ("exam_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_usage_log_assignment_idx" ON "ai_usage_log" ("assignment_id");
--> statement-breakpoint
INSERT INTO "model_prices" ("model", "input_per_million", "cached_input_per_million", "output_per_million") VALUES
  ('gpt-5.6-luna', 0.2, 0.02, 1.2),
  ('gpt-5.6-terra', 2.0, 0.2, 12.0),
  ('gpt-5.6-sol', 4.0, 0.4, 20.0),
  ('gpt-6-luna', 0.1, 0.01, 0.5),
  ('gpt-6-sol', 2.0, 0.2, 10.0),
  ('gpt-6.1-terra', 1.0, 0.05, 5.0),
  ('gpt-6.1-sol', 2.0, 0.1, 10.0),
  ('gpt-6-astra', 10.0, 1.0, 50.0),
  ('gpt-4.1-mini', 0.4, 0.1, 1.6),
  ('gpt-4.1', 2.0, 0.5, 8.0),
  ('gpt-4o', 2.5, 1.25, 10.0),
  ('gpt-4o-mini', 0.15, 0.075, 0.6),
  ('gpt-5', 1.25, 0.125, 10.0),
  ('gpt-5-mini', 0.25, 0.025, 2.0),
  ('gpt-5-nano', 0.05, 0.005, 0.4),
  ('text-embedding-3-small', 0.02, 0.02, 0)
ON CONFLICT ("model") DO NOTHING;
