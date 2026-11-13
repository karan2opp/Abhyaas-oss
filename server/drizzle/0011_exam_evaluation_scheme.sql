ALTER TABLE "exams" ADD COLUMN "evaluation_scheme" text;--> statement-breakpoint
ALTER TABLE "exams" ADD COLUMN "rubric_status" text DEFAULT 'ready' NOT NULL;