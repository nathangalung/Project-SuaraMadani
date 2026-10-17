CREATE TABLE "content_complaints" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"public_code" text NOT NULL,
	"user_id" uuid,
	"submission_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"part" text NOT NULL,
	"explanation" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"decision" text,
	"decision_reason" text,
	"decision_text" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"appeal_text" text,
	"appealed_at" timestamp with time zone,
	"appeal_decision" text,
	"appeal_reason" text,
	"appeal_decision_text" text,
	"appeal_decided_by" uuid,
	"appeal_decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_complaints_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "content_complaints_public_code_key" UNIQUE("org_id","public_code"),
	CONSTRAINT "content_complaints_submission_key" UNIQUE("org_id","user_id","submission_id"),
	CONSTRAINT "content_complaints_reason_check" CHECK ("content_complaints"."reason" IN ('personal_data', 'accusation', 'hate', 'false_information', 'sexual_content', 'child_safety', 'political', 'other')),
	CONSTRAINT "content_complaints_part_check" CHECK ("content_complaints"."part" IN ('title_summary', 'responses', 'timeline', 'evidence', 'whole')),
	CONSTRAINT "content_complaints_status_check" CHECK ("content_complaints"."status" IN ('open', 'decided', 'appealed', 'appeal_decided')),
	CONSTRAINT "content_complaints_decision_check" CHECK (("content_complaints"."decision" IS NULL OR "content_complaints"."decision" IN ('keep', 'edit', 'hide', 'remove')) AND ("content_complaints"."appeal_decision" IS NULL OR "content_complaints"."appeal_decision" IN ('keep', 'edit', 'hide', 'remove')) AND ("content_complaints"."decision_reason" IS NULL OR "content_complaints"."decision_reason" IN ('no_violation', 'insufficient_detail', 'standard_1', 'standard_2', 'standard_3', 'standard_4', 'standard_5', 'standard_6', 'standard_7', 'standard_8', 'standard_9', 'standard_10', 'standard_11', 'standard_12', 'standard_13')) AND ("content_complaints"."appeal_reason" IS NULL OR "content_complaints"."appeal_reason" IN ('no_violation', 'insufficient_detail', 'standard_1', 'standard_2', 'standard_3', 'standard_4', 'standard_5', 'standard_6', 'standard_7', 'standard_8', 'standard_9', 'standard_10', 'standard_11', 'standard_12', 'standard_13'))),
	CONSTRAINT "content_complaints_decided_check" CHECK (("content_complaints"."status" IN ('decided', 'appealed', 'appeal_decided')) = ("content_complaints"."decision" IS NOT NULL AND "content_complaints"."decision_reason" IS NOT NULL AND "content_complaints"."decision_text" IS NOT NULL AND "content_complaints"."decided_by" IS NOT NULL AND "content_complaints"."decided_at" IS NOT NULL)),
	CONSTRAINT "content_complaints_appealed_check" CHECK (("content_complaints"."status" IN ('appealed', 'appeal_decided')) = ("content_complaints"."appeal_text" IS NOT NULL AND "content_complaints"."appealed_at" IS NOT NULL)),
	CONSTRAINT "content_complaints_appeal_decided_check" CHECK (("content_complaints"."status" = 'appeal_decided') = ("content_complaints"."appeal_decision" IS NOT NULL AND "content_complaints"."appeal_reason" IS NOT NULL AND "content_complaints"."appeal_decision_text" IS NOT NULL AND "content_complaints"."appeal_decided_by" IS NOT NULL AND "content_complaints"."appeal_decided_at" IS NOT NULL)),
	CONSTRAINT "content_complaints_appeal_moderator_check" CHECK ("content_complaints"."appeal_decided_by" IS NULL OR "content_complaints"."appeal_decided_by" <> "content_complaints"."decided_by")
);
--> statement-breakpoint
ALTER TABLE "content_complaints" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "redaction_originals" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"column" text NOT NULL,
	"original" text NOT NULL,
	"reason_code" text NOT NULL,
	"complaint_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "redaction_originals_column_check" CHECK ("redaction_originals"."column" IN ('title', 'summary')),
	CONSTRAINT "redaction_originals_reason_check" CHECK ("redaction_originals"."reason_code" IN ('standard_1', 'standard_2', 'standard_3', 'standard_4', 'standard_5', 'standard_6', 'standard_7', 'standard_8', 'standard_9', 'standard_10', 'standard_11', 'standard_12', 'standard_13'))
);
--> statement-breakpoint
ALTER TABLE "redaction_originals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "takedowns" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"action" text NOT NULL,
	"issue_id" uuid,
	"complaint_id" uuid,
	"public_files" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"evidence_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"purge_status" text DEFAULT 'pending' NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"done_at" timestamp with time zone,
	CONSTRAINT "takedowns_action_check" CHECK ("takedowns"."action" IN ('redact', 'unpublish', 'take_down', 'remove_on_request')),
	CONSTRAINT "takedowns_status_check" CHECK ("takedowns"."purge_status" IN ('pending', 'retrying', 'done')),
	CONSTRAINT "takedowns_done_check" CHECK (("takedowns"."purge_status" = 'done') = ("takedowns"."done_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "takedowns" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_template_check";--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_subject_check";--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "redacted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "redaction_reason" text;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "taken_down_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "takedown_reason" text;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "complaint_id" uuid;--> statement-breakpoint
ALTER TABLE "content_complaints" ADD CONSTRAINT "content_complaints_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_complaints" ADD CONSTRAINT "content_complaints_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_complaints" ADD CONSTRAINT "content_complaints_issue_fk" FOREIGN KEY ("org_id","issue_id") REFERENCES "public"."issues"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "redaction_originals" ADD CONSTRAINT "redaction_originals_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "redaction_originals" ADD CONSTRAINT "redaction_originals_issue_fk" FOREIGN KEY ("org_id","issue_id") REFERENCES "public"."issues"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "takedowns" ADD CONSTRAINT "takedowns_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "content_complaints_queue_idx" ON "content_complaints" USING btree ("org_id","status","created_at");--> statement-breakpoint
CREATE INDEX "content_complaints_issue_idx" ON "content_complaints" USING btree ("org_id","issue_id");--> statement-breakpoint
CREATE INDEX "content_complaints_user_idx" ON "content_complaints" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "redaction_originals_issue_idx" ON "redaction_originals" USING btree ("org_id","issue_id","created_at");--> statement-breakpoint
CREATE INDEX "takedowns_status_idx" ON "takedowns" USING btree ("org_id","purge_status","created_at");--> statement-breakpoint
CREATE INDEX "takedowns_complaint_idx" ON "takedowns" USING btree ("org_id","complaint_id");--> statement-breakpoint
-- FK check runs under RLS
ALTER TABLE "notifications" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_complaint_fk" FOREIGN KEY ("org_id","complaint_id") REFERENCES "public"."content_complaints"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_redaction_check" CHECK (("issues"."redacted_at" IS NULL) = ("issues"."redaction_reason" IS NULL) AND ("issues"."redaction_reason" IS NULL OR "issues"."redaction_reason" IN ('standard_1', 'standard_2', 'standard_3', 'standard_4', 'standard_5', 'standard_6', 'standard_7', 'standard_8', 'standard_9', 'standard_10', 'standard_11', 'standard_12', 'standard_13')));--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_takedown_check" CHECK (("issues"."taken_down_at" IS NULL) = ("issues"."takedown_reason" IS NULL) AND ("issues"."takedown_reason" IS NULL OR "issues"."takedown_reason" IN ('standard_1', 'standard_2', 'standard_3', 'standard_4', 'standard_5', 'standard_6', 'standard_7', 'standard_8', 'standard_9', 'standard_10', 'standard_11', 'standard_12', 'standard_13')) AND ("issues"."taken_down_at" IS NULL OR "issues"."published_at" IS NULL));--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_template_check" CHECK ("notifications"."template" IN ('report_submitted', 'report_in_review', 'report_verified', 'report_unverifiable', 'report_rejected', 'report_merged', 'report_forwarded', 'issue_refer', 'issue_escalate', 'issue_record_response', 'issue_mark_in_progress', 'issue_claim_resolved', 'issue_confirm_resolved', 'issue_reopen', 'issue_mark_not_competent', 'issue_mark_not_followed_up', 'issue_close', 'issue_published', 'complaint_received', 'complaint_decided', 'complaint_appeal_decided'));--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_subject_check" CHECK (num_nonnulls("notifications"."report_id", "notifications"."issue_id", "notifications"."complaint_id") = 1);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "content_complaints" AS PERMISSIVE FOR ALL TO public USING (org_id = (SELECT public.current_org_id())) WITH CHECK (org_id = (SELECT public.current_org_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "redaction_originals" AS PERMISSIVE FOR ALL TO public USING (org_id = (SELECT public.current_org_id())) WITH CHECK (org_id = (SELECT public.current_org_id()));--> statement-breakpoint
CREATE POLICY "staff_only" ON "redaction_originals" AS RESTRICTIVE FOR ALL TO public USING (current_setting('app.member_role', true) IN ('moderator', 'admin')) WITH CHECK (current_setting('app.member_role', true) IN ('moderator', 'admin'));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "takedowns" AS PERMISSIVE FOR ALL TO public USING (org_id = (SELECT public.current_org_id())) WITH CHECK (org_id = (SELECT public.current_org_id()));--> statement-breakpoint
-- FORCE covers the owner too
ALTER TABLE "content_complaints" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "redaction_originals" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "takedowns" FORCE ROW LEVEL SECURITY;
