-- Owner bypass for the rewrite
ALTER TABLE "referrals" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
UPDATE "referrals" SET "channel" = 'agency_service' WHERE "channel" = 'sp4n_lapor';--> statement-breakpoint
ALTER TABLE "referrals" DROP CONSTRAINT "referrals_channel_check";--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_channel_check" CHECK (("referrals"."kind" = 'referral' AND "referrals"."channel" IN ('official_letter', 'agency_email', 'agency_service', 'hearing')) OR ("referrals"."kind" = 'escalation' AND "referrals"."channel" IN ('ombudsman', 'dprd', 'media'))) NOT VALID;--> statement-breakpoint
ALTER TABLE "referrals" FORCE ROW LEVEL SECURITY;
