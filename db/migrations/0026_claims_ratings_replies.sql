-- Resolution claims, ratings, surveys, replies
CREATE TABLE "fix_surveys" (
	"org_id" uuid NOT NULL,
	"claim_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"answer" text,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"answered_at" timestamp with time zone,
	CONSTRAINT "fix_surveys_org_id_claim_id_user_id_pk" PRIMARY KEY("org_id","claim_id","user_id"),
	CONSTRAINT "fix_surveys_answer_check" CHECK (("fix_surveys"."answer" IS NULL) = ("fix_surveys"."answered_at" IS NULL) AND ("fix_surveys"."answer" IS NULL OR "fix_surveys"."answer" IN ('fixed', 'not_fixed')))
);
--> statement-breakpoint
ALTER TABLE "fix_surveys" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ratings" (
	"org_id" uuid NOT NULL,
	"claim_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"score" smallint NOT NULL,
	"is_reporter" boolean NOT NULL,
	"account_days" integer NOT NULL,
	"client_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ratings_org_id_claim_id_user_id_pk" PRIMARY KEY("org_id","claim_id","user_id"),
	CONSTRAINT "ratings_score_check" CHECK ("ratings"."score" BETWEEN 1 AND 5),
	CONSTRAINT "ratings_account_days_check" CHECK ("ratings"."account_days" >= 0)
);
--> statement-breakpoint
ALTER TABLE "ratings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "resolution_claims" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"claimed_by" uuid,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"survey_sent_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"outcome" text,
	"basis" text,
	"closed_by" uuid,
	"evidence_url" text,
	CONSTRAINT "resolution_claims_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "resolution_claims_outcome_check" CHECK ("resolution_claims"."outcome" IS NULL OR "resolution_claims"."outcome" IN ('confirmed', 'reopened')),
	CONSTRAINT "resolution_claims_basis_check" CHECK ("resolution_claims"."basis" IS NULL OR "resolution_claims"."basis" IN ('survey', 'admin')),
	CONSTRAINT "resolution_claims_closed_check" CHECK (("resolution_claims"."closed_at" IS NULL) = ("resolution_claims"."outcome" IS NULL) AND ("resolution_claims"."closed_at" IS NULL) = ("resolution_claims"."basis" IS NULL)),
	CONSTRAINT "resolution_claims_evidence_check" CHECK ("resolution_claims"."evidence_url" IS NULL OR ("resolution_claims"."evidence_url" ~ '^https?://' AND "resolution_claims"."outcome" = 'confirmed' AND "resolution_claims"."basis" = 'admin'))
);
--> statement-breakpoint
ALTER TABLE "resolution_claims" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "agency_replies" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"user_id" uuid,
	"submission_id" uuid NOT NULL,
	"agency" text NOT NULL,
	"sender_role" text NOT NULL,
	"body" text NOT NULL,
	"source_url" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"reject_reason" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"response_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agency_replies_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "agency_replies_submission_key" UNIQUE("user_id","submission_id"),
	CONSTRAINT "agency_replies_status_check" CHECK ("agency_replies"."status" IN ('pending', 'accepted', 'rejected')),
	CONSTRAINT "agency_replies_reason_check" CHECK ("agency_replies"."reject_reason" IS NULL OR "agency_replies"."reject_reason" IN ('sender_unconfirmed', 'off_topic', 'personal_data', 'already_recorded')),
	CONSTRAINT "agency_replies_decision_check" CHECK (("agency_replies"."status" = 'pending') = ("agency_replies"."decided_at" IS NULL) AND ("agency_replies"."status" = 'rejected') = ("agency_replies"."reject_reason" IS NOT NULL) AND ("agency_replies"."status" = 'accepted') = ("agency_replies"."response_id" IS NOT NULL)),
	CONSTRAINT "agency_replies_source_check" CHECK ("agency_replies"."source_url" IS NULL OR "agency_replies"."source_url" ~ '^https?://')
);
--> statement-breakpoint
ALTER TABLE "agency_replies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_template_check";--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_subject_check";--> statement-breakpoint
ALTER TABLE "issue_events" ADD COLUMN "claim_id" uuid;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "reply_id" uuid;--> statement-breakpoint
ALTER TABLE "fix_surveys" ADD CONSTRAINT "fix_surveys_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fix_surveys" ADD CONSTRAINT "fix_surveys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fix_surveys" ADD CONSTRAINT "fix_surveys_claim_fk" FOREIGN KEY ("org_id","claim_id") REFERENCES "public"."resolution_claims"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_claim_fk" FOREIGN KEY ("org_id","claim_id") REFERENCES "public"."resolution_claims"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resolution_claims" ADD CONSTRAINT "resolution_claims_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resolution_claims" ADD CONSTRAINT "resolution_claims_issue_fk" FOREIGN KEY ("org_id","issue_id") REFERENCES "public"."issues"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_replies" ADD CONSTRAINT "agency_replies_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_replies" ADD CONSTRAINT "agency_replies_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_replies" ADD CONSTRAINT "agency_replies_issue_fk" FOREIGN KEY ("org_id","issue_id") REFERENCES "public"."issues"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_replies" ADD CONSTRAINT "agency_replies_response_fk" FOREIGN KEY ("org_id","response_id") REFERENCES "public"."responses"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fix_surveys_user_idx" ON "fix_surveys" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ratings_user_idx" ON "ratings" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ratings_client_idx" ON "ratings" USING btree ("org_id","claim_id","client_hash") WHERE "ratings"."client_hash" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "resolution_claims_open_key" ON "resolution_claims" USING btree ("org_id","issue_id") WHERE "resolution_claims"."closed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "resolution_claims_issue_idx" ON "resolution_claims" USING btree ("org_id","issue_id","claimed_at" desc);--> statement-breakpoint
CREATE INDEX "agency_replies_queue_idx" ON "agency_replies" USING btree ("org_id","status","created_at" desc);--> statement-breakpoint
CREATE INDEX "agency_replies_issue_idx" ON "agency_replies" USING btree ("org_id","issue_id");--> statement-breakpoint
CREATE INDEX "agency_replies_user_idx" ON "agency_replies" USING btree ("user_id") WHERE "agency_replies"."user_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "agency_replies_response_idx" ON "agency_replies" USING btree ("org_id","response_id") WHERE "agency_replies"."response_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "issue_events" ADD CONSTRAINT "issue_events_claim_fk" FOREIGN KEY ("org_id","claim_id") REFERENCES "public"."resolution_claims"("org_id","id") ON DELETE cascade ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_reply_fk" FOREIGN KEY ("org_id","reply_id") REFERENCES "public"."agency_replies"("org_id","id") ON DELETE cascade ON UPDATE no action NOT VALID;--> statement-breakpoint
CREATE INDEX "issue_events_claim_idx" ON "issue_events" USING btree ("org_id","claim_id") WHERE "issue_events"."claim_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "notifications_reply_idx" ON "notifications" USING btree ("org_id","reply_id") WHERE "notifications"."reply_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_template_check" CHECK ("notifications"."template" IN ('report_submitted', 'report_in_review', 'report_verified', 'report_unverifiable', 'report_rejected', 'report_merged', 'report_forwarded', 'issue_refer', 'issue_escalate', 'issue_record_response', 'issue_mark_in_progress', 'issue_claim_resolved', 'issue_confirm_resolved', 'issue_reopen', 'issue_mark_not_competent', 'issue_mark_not_followed_up', 'issue_close', 'issue_published', 'complaint_received', 'complaint_decided', 'complaint_appeal_decided', 'demand_publish', 'demand_close', 'demand_reopen', 'demand_update', 'referral_deadline', 'claim_survey', 'reply_received', 'reply_decided')) NOT VALID;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_subject_check" CHECK (num_nonnulls("notifications"."report_id", "notifications"."issue_id", "notifications"."complaint_id", "notifications"."demand_id", "notifications"."reply_id") = CASE WHEN "notifications"."template" IN ('referral_deadline') THEN 0 ELSE 1 END) NOT VALID;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "fix_surveys" AS PERMISSIVE FOR ALL TO public USING (org_id = (SELECT public.current_org_id())) WITH CHECK (org_id = (SELECT public.current_org_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "ratings" AS PERMISSIVE FOR ALL TO public USING (org_id = (SELECT public.current_org_id())) WITH CHECK (org_id = (SELECT public.current_org_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "resolution_claims" AS PERMISSIVE FOR ALL TO public USING (org_id = (SELECT public.current_org_id())) WITH CHECK (org_id = (SELECT public.current_org_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "agency_replies" AS PERMISSIVE FOR ALL TO public USING (org_id = (SELECT public.current_org_id())) WITH CHECK (org_id = (SELECT public.current_org_id()));;--> statement-breakpoint
-- Owner bypass for the backfill
ALTER TABLE "issues" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "issue_events" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- Open claim per claimed issue
INSERT INTO "resolution_claims" ("org_id", "issue_id", "claimed_at")
SELECT i."org_id", i."id", coalesce((SELECT max(e."occurred_at") FROM "issue_events" e WHERE e."org_id" = i."org_id" AND e."issue_id" = i."id" AND e."action" = 'claim_resolved'), i."updated_at")
FROM "issues" i WHERE i."gov_status" = 'claimed_resolved';--> statement-breakpoint
UPDATE "issue_events" e SET "claim_id" = c."id" FROM "resolution_claims" c WHERE e."org_id" = c."org_id" AND e."issue_id" = c."issue_id" AND e."action" = 'claim_resolved' AND e."occurred_at" = c."claimed_at";--> statement-breakpoint
ALTER TABLE "issues" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "issue_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- FORCE covers the owner too
ALTER TABLE "resolution_claims" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ratings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "fix_surveys" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "agency_replies" FORCE ROW LEVEL SECURITY;
