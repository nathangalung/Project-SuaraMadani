ALTER TABLE "evidence" DROP CONSTRAINT "evidence_status_check";--> statement-breakpoint
ALTER TABLE "evidence" ADD COLUMN "failure_reason" text;--> statement-breakpoint
ALTER TABLE "evidence" ADD COLUMN "duration_ms" integer;--> statement-breakpoint
ALTER TABLE "evidence" ADD COLUMN "width" integer;--> statement-breakpoint
ALTER TABLE "evidence" ADD COLUMN "height" integer;--> statement-breakpoint
ALTER TABLE "evidence" ADD COLUMN "source_pages" integer;--> statement-breakpoint
ALTER TABLE "evidence" ADD COLUMN "preview_pages" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "evidence" ADD COLUMN "decision" text;--> statement-breakpoint
ALTER TABLE "evidence" ADD COLUMN "redaction_boxes" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "evidence" ADD COLUMN "publish_pages" smallint[];--> statement-breakpoint
ALTER TABLE "evidence" ADD COLUMN "decided_by" uuid;--> statement-breakpoint
ALTER TABLE "evidence" ADD COLUMN "decided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "evidence" ADD COLUMN "public_media" jsonb;--> statement-breakpoint
ALTER TABLE "evidence" ADD COLUMN "published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_failure_reason_check" CHECK ("evidence"."failure_reason" IS NULL OR "evidence"."failure_reason" IN ('sha256_mismatch', 'unsupported_type', 'decode_failed', 'attempts_exhausted', 'multi_image', 'malware', 'video_too_long', 'video_resolution', 'no_video_stream', 'timeout'));--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_decision_check" CHECK ("evidence"."decision" IS NULL OR "evidence"."decision" IN ('redact', 'no_redaction', 'withhold'));--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_decided_check" CHECK (("evidence"."decision" IS NULL) = ("evidence"."decided_at" IS NULL));--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_published_check" CHECK (("evidence"."status" = 'published') = ("evidence"."published_at" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_status_check" CHECK ("evidence"."status" IN ('awaiting_upload', 'received', 'ready', 'missing', 'rejected_limits', 'needs_manual_review', 'rejected_malware', 'published'));--> statement-breakpoint
-- Existing photo previews, per tenant
DO $$
DECLARE
  org record;
BEGIN
  FOR org IN SELECT id FROM "organizations" LOOP
    PERFORM set_config('app.org_id', org.id::text, true);
    UPDATE "evidence" SET "preview_pages" = 1
      WHERE "kind" = 'image' AND "status" IN ('ready', 'published');
  END LOOP;
  PERFORM set_config('app.org_id', '', true);
END $$;
