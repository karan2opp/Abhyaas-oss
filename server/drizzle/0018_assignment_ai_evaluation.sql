ALTER TABLE "assignments" ADD COLUMN IF NOT EXISTS "ai_evaluation" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN IF NOT EXISTS "evaluation_scheme" text;
--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN IF NOT EXISTS "rubric_status" text DEFAULT 'ready' NOT NULL;
