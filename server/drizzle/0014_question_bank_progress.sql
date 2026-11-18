ALTER TABLE "question_bank_documents" ADD COLUMN IF NOT EXISTS "progress" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "question_bank_documents" ADD COLUMN IF NOT EXISTS "progress_label" text;
