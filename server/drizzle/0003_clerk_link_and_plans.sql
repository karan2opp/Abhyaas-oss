CREATE TABLE "plans" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"price_paise" integer,
	"currency" text DEFAULT 'INR' NOT NULL,
	"duration_days" integer,
	"question_generation_limit" integer,
	"ai_grading_limit" integer,
	"features" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_contact_only" boolean DEFAULT false NOT NULL,
	"is_public" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "clerk_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "onboarded" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_clerk_id_unique" UNIQUE("clerk_id");--> statement-breakpoint
-- Accounts that already exist chose their role when they registered, so they skip the role question.
UPDATE "users" SET "onboarded" = true;
--> statement-breakpoint
-- The plans. Prices are in paise (₹149 = 14900). The paid plans are 30-day packs paid once, not auto-renewing subscriptions.
-- To change a limit or a price later, UPDATE the row; no deploy is needed.
INSERT INTO "plans" ("id", "name", "description", "price_paise", "duration_days", "question_generation_limit", "ai_grading_limit", "features", "is_contact_only", "sort_order") VALUES
	('free', 'Free', 'Try it out.', 0, NULL, 50, 0, '["50 AI-written questions, once per account"]'::jsonb, false, 0),
	('basic', 'Basic', 'AI-written questions, graded by you.', 9900, 30, 300, 0, '["300 AI-written questions","30 days","AI grading not included"]'::jsonb, false, 1),
	('plus', 'Plus', 'Questions plus AI grading for a class.', 14900, 30, 500, 100, '["500 AI-written questions","AI grading for 100 student answers","30 days"]'::jsonb, false, 2),
	('pro', 'Pro', 'More questions and more AI grading.', 29900, 30, 1000, 250, '["1,000 AI-written questions","AI grading for 250 student answers","30 days"]'::jsonb, false, 3),
	('custom', 'Custom', 'A plan built around your school or institute.', NULL, NULL, NULL, NULL, '["Limits agreed with you","Contact our team"]'::jsonb, true, 4)
ON CONFLICT ("id") DO NOTHING;
