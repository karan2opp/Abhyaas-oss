ALTER TABLE "assignment_questions" ADD COLUMN IF NOT EXISTS "position" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "assignment_questions" ADD COLUMN IF NOT EXISTS "content_blocks" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "assignment_questions" ADD COLUMN IF NOT EXISTS "topic" text;
--> statement-breakpoint
ALTER TABLE "assignment_questions" ADD COLUMN IF NOT EXISTS "subtopic" text;
--> statement-breakpoint
ALTER TABLE "assignment_options" ADD COLUMN IF NOT EXISTS "is_code" boolean DEFAULT false NOT NULL;
