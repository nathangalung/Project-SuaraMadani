ALTER TABLE "evidence" DROP CONSTRAINT "evidence_failure_reason_check";--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "step_up_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "step_up_failures" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "evidence" ADD COLUMN "scanned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "forwarded_from_code" text;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_failure_reason_check" CHECK ("evidence"."failure_reason" IS NULL OR "evidence"."failure_reason" IN ('sha256_mismatch', 'unsupported_type', 'decode_failed', 'attempts_exhausted', 'multi_image', 'malware', 'video_too_long', 'video_resolution', 'no_video_stream', 'timeout', 'image_too_large')) NOT VALID;--> statement-breakpoint
-- Ready PDFs passed the scan
ALTER TABLE "evidence" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
UPDATE "evidence" SET "scanned_at" = "updated_at" WHERE "kind" = 'pdf' AND "status" IN ('ready', 'published');--> statement-breakpoint
ALTER TABLE "evidence" FORCE ROW LEVEL SECURITY;
