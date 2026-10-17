CREATE TABLE "email_log" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"kind" text NOT NULL,
	"address_hash" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "email_log_kind_check" CHECK ("email_log"."kind" IN ('otp', 'notification')),
	CONSTRAINT "email_log_status_check" CHECK ("email_log"."status" IN ('reserved', 'sent', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "follows" (
	"org_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "follows_org_id_issue_id_user_id_pk" PRIMARY KEY("org_id","issue_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "follows" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid,
	"event_id" uuid NOT NULL,
	"template" text NOT NULL,
	"report_id" uuid,
	"issue_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"error" text,
	"claimed_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_event_user_key" UNIQUE("org_id","event_id","user_id"),
	CONSTRAINT "notifications_template_check" CHECK ("notifications"."template" IN ('report_submitted', 'report_in_review', 'report_verified', 'report_unverifiable', 'report_rejected', 'report_merged', 'report_forwarded', 'issue_refer', 'issue_escalate', 'issue_record_response', 'issue_mark_in_progress', 'issue_claim_resolved', 'issue_confirm_resolved', 'issue_reopen', 'issue_mark_not_competent', 'issue_mark_not_followed_up', 'issue_close', 'issue_published')),
	CONSTRAINT "notifications_status_check" CHECK ("notifications"."status" IN ('pending', 'sending', 'sent', 'failed', 'skipped')),
	CONSTRAINT "notifications_subject_check" CHECK (("notifications"."report_id" IS NULL) <> ("notifications"."issue_id" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "follows" ADD CONSTRAINT "follows_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follows" ADD CONSTRAINT "follows_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follows" ADD CONSTRAINT "follows_issue_fk" FOREIGN KEY ("org_id","issue_id") REFERENCES "public"."issues"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_report_fk" FOREIGN KEY ("org_id","report_id") REFERENCES "public"."reports"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_issue_fk" FOREIGN KEY ("org_id","issue_id") REFERENCES "public"."issues"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_log_kind_created_idx" ON "email_log" USING btree ("kind","created_at");--> statement-breakpoint
CREATE INDEX "email_log_address_idx" ON "email_log" USING btree ("address_hash","created_at");--> statement-breakpoint
CREATE INDEX "follows_user_idx" ON "follows" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "notifications_status_idx" ON "notifications" USING btree ("org_id","status","created_at");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "follows" AS PERMISSIVE FOR ALL TO public USING (org_id = (SELECT public.current_org_id())) WITH CHECK (org_id = (SELECT public.current_org_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "notifications" AS PERMISSIVE FOR ALL TO public USING (org_id = (SELECT public.current_org_id())) WITH CHECK (org_id = (SELECT public.current_org_id()));--> statement-breakpoint
-- FORCE covers the owner too
ALTER TABLE "follows" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notifications" FORCE ROW LEVEL SECURITY;