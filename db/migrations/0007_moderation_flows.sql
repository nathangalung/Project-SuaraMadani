CREATE TABLE "issue_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"action" text NOT NULL,
	"advocacy_status" text NOT NULL,
	"gov_status" text NOT NULL,
	"referral_id" uuid,
	"response_id" uuid,
	"note" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "issue_events_action_check" CHECK ("issue_events"."action" IN ('refer', 'escalate', 'record_response', 'mark_in_progress', 'claim_resolved', 'confirm_resolved', 'reopen', 'mark_not_competent', 'mark_not_followed_up', 'close', 'merge')),
	CONSTRAINT "issue_events_advocacy_check" CHECK ("issue_events"."advocacy_status" IN ('monitoring', 'referred', 'escalated')),
	CONSTRAINT "issue_events_gov_check" CHECK ("issue_events"."gov_status" IN ('awaiting_response', 'responded', 'in_progress', 'claimed_resolved', 'confirmed_resolved', 'reopened', 'not_competent', 'not_followed_up', 'closed'))
);
--> statement-breakpoint
ALTER TABLE "issue_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "referrals" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"agency" text NOT NULL,
	"channel" text NOT NULL,
	"ticket" text,
	"sent_on" date NOT NULL,
	"deadline_on" date,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "referrals_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "referrals_kind_check" CHECK ("referrals"."kind" IN ('referral', 'escalation')),
	CONSTRAINT "referrals_channel_check" CHECK (("referrals"."kind" = 'referral' AND "referrals"."channel" IN ('sp4n_lapor', 'official_letter', 'agency_email', 'agency_service', 'hearing')) OR ("referrals"."kind" = 'escalation' AND "referrals"."channel" IN ('ombudsman', 'dprd', 'media'))),
	CONSTRAINT "referrals_deadline_check" CHECK (("referrals"."kind" = 'escalation' OR "referrals"."deadline_on" IS NOT NULL) AND ("referrals"."deadline_on" IS NULL OR "referrals"."deadline_on" >= "referrals"."sent_on"))
);
--> statement-breakpoint
ALTER TABLE "referrals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "responses" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"agency" text NOT NULL,
	"body" text NOT NULL,
	"responded_on" date NOT NULL,
	"source_url" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "responses_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "responses_source_check" CHECK ("responses"."source_url" ~ '^https?://')
);
--> statement-breakpoint
ALTER TABLE "responses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "moderation_decisions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"report_id" uuid NOT NULL,
	"action" text NOT NULL,
	"reason_code" text NOT NULL,
	"reason_text" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "moderation_decisions_action_check" CHECK ("moderation_decisions"."action" IN ('verify', 'mark_unverifiable', 'reject')),
	CONSTRAINT "moderation_decisions_reason_check" CHECK (("moderation_decisions"."action" = 'verify' AND "moderation_decisions"."reason_code" IN ('document', 'site_photo', 'second_party', 'news_source') AND "moderation_decisions"."reason_text" IS NULL) OR ("moderation_decisions"."action" = 'reject' AND "moderation_decisions"."reason_code" IN ('standard_1', 'standard_2', 'standard_3', 'standard_4', 'standard_5', 'standard_6', 'standard_7', 'standard_8', 'standard_9', 'standard_10', 'standard_11', 'standard_12', 'standard_13', 'out_of_scope') AND "moderation_decisions"."reason_text" IS NOT NULL) OR ("moderation_decisions"."action" = 'mark_unverifiable' AND "moderation_decisions"."reason_code" IN ('no_evidence', 'source_unreachable', 'conflicting_information', 'location_unclear') AND "moderation_decisions"."reason_text" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "moderation_decisions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "forwarded_from_org_id" uuid;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "forwarded_from_report_id" uuid;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "forwarded_to_org_id" uuid;--> statement-breakpoint
ALTER TABLE "issue_events" ADD CONSTRAINT "issue_events_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_events" ADD CONSTRAINT "issue_events_issue_fk" FOREIGN KEY ("org_id","issue_id") REFERENCES "public"."issues"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_events" ADD CONSTRAINT "issue_events_referral_fk" FOREIGN KEY ("org_id","referral_id") REFERENCES "public"."referrals"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_events" ADD CONSTRAINT "issue_events_response_fk" FOREIGN KEY ("org_id","response_id") REFERENCES "public"."responses"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_issue_fk" FOREIGN KEY ("org_id","issue_id") REFERENCES "public"."issues"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "responses" ADD CONSTRAINT "responses_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "responses" ADD CONSTRAINT "responses_issue_fk" FOREIGN KEY ("org_id","issue_id") REFERENCES "public"."issues"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_decisions" ADD CONSTRAINT "moderation_decisions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_decisions" ADD CONSTRAINT "moderation_decisions_report_fk" FOREIGN KEY ("org_id","report_id") REFERENCES "public"."reports"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "issue_events_issue_idx" ON "issue_events" USING btree ("org_id","issue_id","occurred_at");--> statement-breakpoint
CREATE INDEX "referrals_issue_idx" ON "referrals" USING btree ("org_id","issue_id","sent_on" desc);--> statement-breakpoint
CREATE INDEX "responses_issue_idx" ON "responses" USING btree ("org_id","issue_id","responded_on" desc);--> statement-breakpoint
CREATE INDEX "moderation_decisions_report_idx" ON "moderation_decisions" USING btree ("org_id","report_id","decided_at");--> statement-breakpoint
-- FK check runs under RLS
ALTER TABLE "reports" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_forwarded_from_org_id_organizations_id_fk" FOREIGN KEY ("forwarded_from_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_forwarded_to_org_id_organizations_id_fk" FOREIGN KEY ("forwarded_to_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_forwarded_from_key" UNIQUE("org_id","forwarded_from_report_id");--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_forwarded_from_check" CHECK (("reports"."forwarded_from_org_id" IS NULL) = ("reports"."forwarded_from_report_id" IS NULL));--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_forwarded_to_check" CHECK ("reports"."forwarded_to_org_id" IS NULL OR "reports"."status" = 'forwarded');--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "issue_events" AS PERMISSIVE FOR ALL TO public USING (org_id = (SELECT public.current_org_id())) WITH CHECK (org_id = (SELECT public.current_org_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "referrals" AS PERMISSIVE FOR ALL TO public USING (org_id = (SELECT public.current_org_id())) WITH CHECK (org_id = (SELECT public.current_org_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "responses" AS PERMISSIVE FOR ALL TO public USING (org_id = (SELECT public.current_org_id())) WITH CHECK (org_id = (SELECT public.current_org_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "moderation_decisions" AS PERMISSIVE FOR ALL TO public USING (org_id = (SELECT public.current_org_id())) WITH CHECK (org_id = (SELECT public.current_org_id()));--> statement-breakpoint
-- FORCE covers the owner too
ALTER TABLE "issue_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "referrals" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "responses" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "moderation_decisions" FORCE ROW LEVEL SECURITY;
