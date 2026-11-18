ALTER TABLE "exams" ADD COLUMN IF NOT EXISTS "ai_evaluation" boolean DEFAULT true NOT NULL;
