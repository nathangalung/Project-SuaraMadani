ALTER TABLE "email_log" DROP CONSTRAINT "email_log_kind_check";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "superadmin" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "logo_bytes" "bytea";--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "logo_hash" text;--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_pending_email_key" ON "invitations" USING btree ("organization_id",lower("email")) WHERE "invitations"."status" = 'pending';--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_status_check" CHECK ("invitations"."status" IN ('pending', 'accepted', 'canceled'));--> statement-breakpoint
ALTER TABLE "email_log" ADD CONSTRAINT "email_log_kind_check" CHECK ("email_log"."kind" IN ('otp', 'notification', 'invitation'));--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_logo_check" CHECK (("organizations"."logo_bytes" IS NULL) = ("organizations"."logo_hash" IS NULL));