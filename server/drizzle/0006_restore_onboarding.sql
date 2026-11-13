ALTER TABLE "users" ADD COLUMN "onboarded" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Every account that exists already has been using the app, so none of them is asked the first-time question.
UPDATE "users" SET "onboarded" = true;
