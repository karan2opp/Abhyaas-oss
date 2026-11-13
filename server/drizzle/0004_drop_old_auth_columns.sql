ALTER TABLE "users" DROP COLUMN "password";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "is_verified";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "verification_token";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "verification_expires";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "refresh_token";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "reset_password_token";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "reset_password_expires";