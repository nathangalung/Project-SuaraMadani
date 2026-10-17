-- Tuntutan, admin authored
CREATE TABLE "demand_follows" (
	"org_id" uuid NOT NULL,
	"demand_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "demand_follows_org_id_demand_id_user_id_pk" PRIMARY KEY("org_id","demand_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "demand_follows" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "demand_issues" (
	"org_id" uuid NOT NULL,
	"demand_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "demand_issues_org_id_demand_id_issue_id_pk" PRIMARY KEY("org_id","demand_id","issue_id")
);
--> statement-breakpoint
ALTER TABLE "demand_issues" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "demand_items" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"demand_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"body" text NOT NULL,
	"response_status" text DEFAULT 'not_responded' NOT NULL,
	"fulfilment_status" text DEFAULT 'not_fulfilled' NOT NULL,
	"brief_summary" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "demand_items_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "demand_items_response_check" CHECK ("demand_items"."response_status" IN ('not_responded', 'responded')),
	CONSTRAINT "demand_items_fulfilment_check" CHECK ("demand_items"."fulfilment_status" IN ('not_fulfilled', 'partially_fulfilled', 'fulfilled', 'rejected')),
	CONSTRAINT "demand_items_rejected_check" CHECK ("demand_items"."fulfilment_status" <> 'rejected' OR "demand_items"."response_status" = 'responded'),
	CONSTRAINT "demand_items_position_check" CHECK ("demand_items"."position" >= 0),
	CONSTRAINT "demand_items_version_check" CHECK ("demand_items"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "demand_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "demand_updates" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"demand_id" uuid NOT NULL,
	"item_id" uuid,
	"action" text NOT NULL,
	"response_status" text,
	"fulfilment_status" text,
	"occurred_on" date NOT NULL,
	"note" text,
	"source_text" text,
	"source_url" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "demand_updates_action_check" CHECK ("demand_updates"."action" IN ('publish', 'close', 'reopen', 'status', 'note', 'brief')),
	CONSTRAINT "demand_updates_item_check" CHECK (("demand_updates"."action" IN ('status', 'note', 'brief')) = ("demand_updates"."item_id" IS NOT NULL)),
	CONSTRAINT "demand_updates_status_check" CHECK (("demand_updates"."action" = 'status') = ("demand_updates"."response_status" IS NOT NULL AND "demand_updates"."fulfilment_status" IS NOT NULL) AND ("demand_updates"."response_status" IS NULL OR "demand_updates"."response_status" IN ('not_responded', 'responded')) AND ("demand_updates"."fulfilment_status" IS NULL OR "demand_updates"."fulfilment_status" IN ('not_fulfilled', 'partially_fulfilled', 'fulfilled', 'rejected'))),
	CONSTRAINT "demand_updates_source_check" CHECK (("demand_updates"."action" NOT IN ('status', 'note') OR ("demand_updates"."note" IS NOT NULL AND "demand_updates"."source_text" IS NOT NULL)) AND ("demand_updates"."source_url" IS NULL OR "demand_updates"."source_url" ~ '^https?://')),
	CONSTRAINT "demand_updates_close_check" CHECK ("demand_updates"."action" <> 'close' OR "demand_updates"."note" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "demand_updates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "demands" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"year" smallint NOT NULL,
	"number" integer NOT NULL,
	"public_code" text NOT NULL,
	"scope" text NOT NULL,
	"province_code" text,
	"regency_code" text,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"summary" text NOT NULL,
	"target" text NOT NULL,
	"raised_on" date NOT NULL,
	"state" text DEFAULT 'draft' NOT NULL,
	"progress" text DEFAULT 'not_fulfilled' NOT NULL,
	"search" "tsvector" GENERATED ALWAYS AS (to_tsvector('indonesian', "demands"."title" || ' ' || "demands"."summary" || ' ' || "demands"."target")) STORED NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"published_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"hidden_at" timestamp with time zone,
	"hidden_reason" text,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "demands_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "demands_org_id_public_code_key" UNIQUE("org_id","public_code"),
	CONSTRAINT "demands_number_key" UNIQUE("org_id","year","number"),
	CONSTRAINT "demands_scope_check" CHECK ("demands"."scope" IN ('national', 'regional')),
	CONSTRAINT "demands_region_check" CHECK (("demands"."scope" = 'national' AND "demands"."province_code" IS NULL AND "demands"."regency_code" IS NULL) OR ("demands"."scope" = 'regional' AND "demands"."province_code" IS NOT NULL AND ("demands"."regency_code" IS NULL OR starts_with("demands"."regency_code", "demands"."province_code" || '.')))),
	CONSTRAINT "demands_state_check" CHECK ("demands"."state" IN ('draft', 'published', 'closed')),
	CONSTRAINT "demands_progress_check" CHECK ("demands"."progress" IN ('not_fulfilled', 'partially_fulfilled', 'fulfilled', 'rejected')),
	CONSTRAINT "demands_published_check" CHECK (("demands"."state" = 'draft' OR "demands"."published_at" IS NOT NULL) AND (("demands"."state" = 'closed') = ("demands"."closed_at" IS NOT NULL))),
	CONSTRAINT "demands_hidden_check" CHECK (("demands"."hidden_at" IS NULL) = ("demands"."hidden_reason" IS NULL) AND ("demands"."hidden_reason" IS NULL OR "demands"."hidden_reason" IN ('standard_1', 'standard_2', 'standard_3', 'standard_4', 'standard_5', 'standard_6', 'standard_7', 'standard_8', 'standard_9', 'standard_10', 'standard_11', 'standard_12', 'standard_13')) AND ("demands"."hidden_at" IS NULL OR "demands"."state" = 'draft')),
	CONSTRAINT "demands_version_check" CHECK ("demands"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "demands" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "policy_briefs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"sha256" text NOT NULL,
	"byte_size" bigint NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"scanned_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	CONSTRAINT "policy_briefs_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "policy_briefs_status_check" CHECK ("policy_briefs"."status" IN ('pending', 'clean', 'infected')),
	CONSTRAINT "policy_briefs_scanned_check" CHECK (("policy_briefs"."status" = 'pending') = ("policy_briefs"."scanned_at" IS NULL)),
	CONSTRAINT "policy_briefs_published_check" CHECK ("policy_briefs"."published_at" IS NULL OR "policy_briefs"."status" = 'clean'),
	CONSTRAINT "policy_briefs_sha_check" CHECK ("policy_briefs"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "policy_briefs_size_check" CHECK ("policy_briefs"."byte_size" > 0)
);
--> statement-breakpoint
ALTER TABLE "policy_briefs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "content_complaints" DROP CONSTRAINT "content_complaints_part_check";--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_template_check";--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_subject_check";--> statement-breakpoint
ALTER TABLE "org_counters" DROP CONSTRAINT "org_counters_kind_check";--> statement-breakpoint
-- Old images write no demands
-- squawk-ignore ban-drop-not-null
ALTER TABLE "content_complaints" ALTER COLUMN "issue_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "content_complaints" ADD COLUMN "demand_id" uuid;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "demand_id" uuid;--> statement-breakpoint
ALTER TABLE "demand_follows" ADD CONSTRAINT "demand_follows_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demand_follows" ADD CONSTRAINT "demand_follows_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demand_follows" ADD CONSTRAINT "demand_follows_demand_fk" FOREIGN KEY ("org_id","demand_id") REFERENCES "public"."demands"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demand_issues" ADD CONSTRAINT "demand_issues_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demand_issues" ADD CONSTRAINT "demand_issues_demand_fk" FOREIGN KEY ("org_id","demand_id") REFERENCES "public"."demands"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demand_issues" ADD CONSTRAINT "demand_issues_issue_fk" FOREIGN KEY ("org_id","issue_id") REFERENCES "public"."issues"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demand_items" ADD CONSTRAINT "demand_items_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demand_items" ADD CONSTRAINT "demand_items_demand_fk" FOREIGN KEY ("org_id","demand_id") REFERENCES "public"."demands"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demand_updates" ADD CONSTRAINT "demand_updates_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demand_updates" ADD CONSTRAINT "demand_updates_demand_fk" FOREIGN KEY ("org_id","demand_id") REFERENCES "public"."demands"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demand_updates" ADD CONSTRAINT "demand_updates_item_fk" FOREIGN KEY ("org_id","item_id") REFERENCES "public"."demand_items"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demands" ADD CONSTRAINT "demands_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demands" ADD CONSTRAINT "demands_province_code_regions_code_fk" FOREIGN KEY ("province_code") REFERENCES "public"."regions"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demands" ADD CONSTRAINT "demands_regency_code_regions_code_fk" FOREIGN KEY ("regency_code") REFERENCES "public"."regions"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_briefs" ADD CONSTRAINT "policy_briefs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_briefs" ADD CONSTRAINT "policy_briefs_item_fk" FOREIGN KEY ("org_id","item_id") REFERENCES "public"."demand_items"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "demand_follows_user_idx" ON "demand_follows" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "demand_issues_issue_idx" ON "demand_issues" USING btree ("org_id","issue_id");--> statement-breakpoint
CREATE INDEX "demand_items_demand_idx" ON "demand_items" USING btree ("org_id","demand_id","position");--> statement-breakpoint
CREATE INDEX "demand_updates_demand_idx" ON "demand_updates" USING btree ("org_id","demand_id","occurred_on","created_at");--> statement-breakpoint
CREATE INDEX "demand_updates_item_idx" ON "demand_updates" USING btree ("org_id","item_id") WHERE "demand_updates"."item_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "demands_public_idx" ON "demands" USING btree ("org_id","published_at" desc,"id" desc) WHERE "demands"."state" <> 'draft';--> statement-breakpoint
CREATE INDEX "demands_activity_idx" ON "demands" USING btree ("org_id","last_activity_at" desc,"id" desc);--> statement-breakpoint
CREATE INDEX "demands_province_idx" ON "demands" USING btree ("org_id","province_code") WHERE "demands"."province_code" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "policy_briefs_item_idx" ON "policy_briefs" USING btree ("org_id","item_id","created_at" desc);--> statement-breakpoint
CREATE INDEX "policy_briefs_status_idx" ON "policy_briefs" USING btree ("status","created_at");--> statement-breakpoint
ALTER TABLE "content_complaints" ADD CONSTRAINT "content_complaints_demand_fk" FOREIGN KEY ("org_id","demand_id") REFERENCES "public"."demands"("org_id","id") ON DELETE cascade ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_demand_fk" FOREIGN KEY ("org_id","demand_id") REFERENCES "public"."demands"("org_id","id") ON DELETE cascade ON UPDATE no action NOT VALID;--> statement-breakpoint
CREATE INDEX "content_complaints_demand_idx" ON "content_complaints" USING btree ("org_id","demand_id") WHERE "content_complaints"."demand_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "notifications_demand_idx" ON "notifications" USING btree ("org_id","demand_id") WHERE "notifications"."demand_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "content_complaints" ADD CONSTRAINT "content_complaints_subject_check" CHECK (num_nonnulls("content_complaints"."issue_id", "content_complaints"."demand_id") = 1) NOT VALID;--> statement-breakpoint
ALTER TABLE "content_complaints" ADD CONSTRAINT "content_complaints_part_check" CHECK ("content_complaints"."part" IN ('title_summary', 'responses', 'timeline', 'evidence', 'demand_items', 'policy_brief', 'whole')) NOT VALID;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_template_check" CHECK ("notifications"."template" IN ('report_submitted', 'report_in_review', 'report_verified', 'report_unverifiable', 'report_rejected', 'report_merged', 'report_forwarded', 'issue_refer', 'issue_escalate', 'issue_record_response', 'issue_mark_in_progress', 'issue_claim_resolved', 'issue_confirm_resolved', 'issue_reopen', 'issue_mark_not_competent', 'issue_mark_not_followed_up', 'issue_close', 'issue_published', 'complaint_received', 'complaint_decided', 'complaint_appeal_decided', 'demand_publish', 'demand_close', 'demand_reopen', 'demand_update')) NOT VALID;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_subject_check" CHECK (num_nonnulls("notifications"."report_id", "notifications"."issue_id", "notifications"."complaint_id", "notifications"."demand_id") = 1) NOT VALID;--> statement-breakpoint
ALTER TABLE "org_counters" ADD CONSTRAINT "org_counters_kind_check" CHECK ("org_counters"."kind" IN ('issue', 'demand')) NOT VALID;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "demand_follows" AS PERMISSIVE FOR ALL TO public USING (org_id = (SELECT public.current_org_id())) WITH CHECK (org_id = (SELECT public.current_org_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "demand_issues" AS PERMISSIVE FOR ALL TO public USING (org_id = (SELECT public.current_org_id())) WITH CHECK (org_id = (SELECT public.current_org_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "demand_items" AS PERMISSIVE FOR ALL TO public USING (org_id = (SELECT public.current_org_id())) WITH CHECK (org_id = (SELECT public.current_org_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "demand_updates" AS PERMISSIVE FOR ALL TO public USING (org_id = (SELECT public.current_org_id())) WITH CHECK (org_id = (SELECT public.current_org_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "demands" AS PERMISSIVE FOR ALL TO public USING (org_id = (SELECT public.current_org_id())) WITH CHECK (org_id = (SELECT public.current_org_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "policy_briefs" AS PERMISSIVE FOR ALL TO public USING (org_id = (SELECT public.current_org_id())) WITH CHECK (org_id = (SELECT public.current_org_id()));--> statement-breakpoint
-- FORCE covers the owner too
ALTER TABLE "demands" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "demand_items" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "demand_updates" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "demand_issues" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "demand_follows" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "policy_briefs" FORCE ROW LEVEL SECURITY;
