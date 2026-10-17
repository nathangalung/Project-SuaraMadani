CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"changed_columns" text[] DEFAULT '{}'::text[] NOT NULL,
	"value_hashes" jsonb,
	"reason_code" text,
	"request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"inviter_id" uuid NOT NULL,
	CONSTRAINT "invitations_role_check" CHECK ("invitations"."role" IN ('reporter', 'moderator', 'editor', 'admin'))
);
--> statement-breakpoint
CREATE TABLE "members" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'reporter' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "members_organization_id_user_id_key" UNIQUE("organization_id","user_id"),
	CONSTRAINT "members_role_check" CHECK ("members"."role" IN ('reporter', 'moderator', 'editor', 'admin'))
);
--> statement-breakpoint
CREATE TABLE "passkeys" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text,
	"public_key" text NOT NULL,
	"user_id" uuid NOT NULL,
	"credential_id" text NOT NULL,
	"counter" integer NOT NULL,
	"device_type" text NOT NULL,
	"backed_up" boolean NOT NULL,
	"transports" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"aaguid" text
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" uuid NOT NULL,
	"active_organization_id" uuid,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "two_factors" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"user_id" uuid NOT NULL,
	"verified" boolean DEFAULT true NOT NULL,
	"failed_verification_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"two_factor_enabled" boolean DEFAULT false NOT NULL,
	"age_declared_at" timestamp with time zone NOT NULL,
	"age_consent_version" text NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issue_reports" (
	"org_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"report_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "issue_reports_issue_id_report_id_pk" PRIMARY KEY("issue_id","report_id"),
	CONSTRAINT "issue_reports_report_key" UNIQUE("org_id","report_id")
);
--> statement-breakpoint
ALTER TABLE "issue_reports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "issues" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"year" smallint NOT NULL,
	"number" integer NOT NULL,
	"public_code" text NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"category_id" text NOT NULL,
	"subcategory_id" text NOT NULL,
	"province_code" text NOT NULL,
	"regency_code" text NOT NULL,
	"district_code" text,
	"advocacy_status" text DEFAULT 'monitoring' NOT NULL,
	"gov_status" text DEFAULT 'awaiting_response' NOT NULL,
	"verification_label" text DEFAULT 'unverified' NOT NULL,
	"report_count" integer DEFAULT 0 NOT NULL,
	"verified_report_count" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"published_at" timestamp with time zone,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "issues_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "issues_org_id_public_code_key" UNIQUE("org_id","public_code"),
	CONSTRAINT "issues_number_key" UNIQUE("org_id","year","number"),
	CONSTRAINT "issues_advocacy_check" CHECK ("issues"."advocacy_status" IN ('monitoring', 'referred', 'escalated')),
	CONSTRAINT "issues_gov_check" CHECK ("issues"."gov_status" IN ('awaiting_response', 'responded', 'in_progress', 'claimed_resolved', 'confirmed_resolved', 'reopened', 'not_competent', 'not_followed_up', 'closed')),
	CONSTRAINT "issues_verification_check" CHECK ("issues"."verification_label" IN ('verified', 'unverified')),
	CONSTRAINT "issues_subcategory_check" CHECK (starts_with("issues"."subcategory_id", "issues"."category_id" || '.')),
	CONSTRAINT "issues_version_check" CHECK ("issues"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "issues" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "org_counters" (
	"org_id" uuid NOT NULL,
	"year" smallint NOT NULL,
	"kind" text NOT NULL,
	"next" integer NOT NULL,
	CONSTRAINT "org_counters_org_id_year_kind_pk" PRIMARY KEY("org_id","year","kind"),
	CONSTRAINT "org_counters_kind_check" CHECK ("org_counters"."kind" IN ('issue')),
	CONSTRAINT "org_counters_next_check" CHECK ("org_counters"."next" > 0)
);
--> statement-breakpoint
ALTER TABLE "org_counters" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo" text,
	"metadata" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"host" text NOT NULL,
	"campus_code" text NOT NULL,
	"campus_name" text NOT NULL,
	"contact_email" text,
	"theme" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug"),
	CONSTRAINT "organizations_host_unique" UNIQUE("host"),
	CONSTRAINT "organizations_campus_code_unique" UNIQUE("campus_code"),
	CONSTRAINT "organizations_campus_code_check" CHECK ("organizations"."campus_code" ~ '^[A-Z][A-Z0-9]{1,9}$')
);
--> statement-breakpoint
CREATE TABLE "regions" (
	"code" text PRIMARY KEY NOT NULL,
	"parent_code" text,
	"level" smallint NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "regions_level_check" CHECK ("regions"."level" BETWEEN 1 AND 4),
	CONSTRAINT "regions_parent_check" CHECK (("regions"."level" = 1) = ("regions"."parent_code" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "evidence" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"report_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"kind" text NOT NULL,
	"declared_name" text NOT NULL,
	"declared_type" text NOT NULL,
	"declared_size" bigint NOT NULL,
	"status" text DEFAULT 'awaiting_upload' NOT NULL,
	"detected_type" text,
	"byte_size" bigint,
	"sha256" text,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"received_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evidence_report_position_key" UNIQUE("report_id","position"),
	CONSTRAINT "evidence_position_check" CHECK ("evidence"."position" >= 0 AND "evidence"."position" < 5),
	CONSTRAINT "evidence_kind_check" CHECK ("evidence"."kind" IN ('image', 'pdf', 'video')),
	CONSTRAINT "evidence_status_check" CHECK ("evidence"."status" IN ('awaiting_upload', 'received', 'ready', 'missing', 'rejected_limits', 'needs_manual_review', 'published')),
	CONSTRAINT "evidence_declared_size_check" CHECK ("evidence"."declared_size" > 0)
);
--> statement-breakpoint
ALTER TABLE "evidence" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "report_contacts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"report_id" uuid NOT NULL,
	"phone" text NOT NULL,
	"method" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_contacts_report_id_unique" UNIQUE("report_id"),
	CONSTRAINT "report_contacts_method_check" CHECK ("report_contacts"."method" IN ('whatsapp', 'phone'))
);
--> statement-breakpoint
ALTER TABLE "report_contacts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"public_code" text NOT NULL,
	"submission_id" uuid NOT NULL,
	"status" text DEFAULT 'submitted' NOT NULL,
	"relation" text NOT NULL,
	"other_consent" text,
	"province_code" text NOT NULL,
	"regency_code" text NOT NULL,
	"district_code" text NOT NULL,
	"village_code" text,
	"point" geometry(Point,4326),
	"title" text NOT NULL,
	"story" text NOT NULL,
	"category_id" text NOT NULL,
	"subcategory_id" text NOT NULL,
	"occurred_on" date NOT NULL,
	"agency" text,
	"urgency" text NOT NULL,
	"affected_groups" text[] NOT NULL,
	"affected_count" text NOT NULL,
	"ongoing" text NOT NULL,
	"contactable" boolean NOT NULL,
	"consents" text[] NOT NULL,
	"consent_text_version" text NOT NULL,
	"consented_at" timestamp with time zone DEFAULT now() NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reports_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "reports_org_id_public_code_key" UNIQUE("org_id","public_code"),
	CONSTRAINT "reports_submission_key" UNIQUE("org_id","user_id","submission_id"),
	CONSTRAINT "reports_status_check" CHECK ("reports"."status" IN ('submitted', 'in_review', 'verified', 'unverifiable', 'rejected', 'merged', 'forwarded')),
	CONSTRAINT "reports_relation_check" CHECK ("reports"."relation" IN ('self', 'on_behalf', 'witness')),
	CONSTRAINT "reports_other_consent_check" CHECK (("reports"."relation" = 'on_behalf') = ("reports"."other_consent" IS NOT NULL) AND ("reports"."other_consent" IS NULL OR "reports"."other_consent" IN ('yes', 'not_asked', 'cannot_ask'))),
	CONSTRAINT "reports_subcategory_check" CHECK (starts_with("reports"."subcategory_id", "reports"."category_id" || '.')),
	CONSTRAINT "reports_urgency_check" CHECK ("reports"."urgency" IN ('low', 'medium', 'high', 'emergency')),
	CONSTRAINT "reports_affected_groups_check" CHECK (cardinality("reports"."affected_groups") > 0 AND "reports"."affected_groups" <@ ARRAY['children', 'elderly', 'people_with_disabilities', 'women', 'students', 'workers', 'farmers_fishers', 'general_public']::text[]),
	CONSTRAINT "reports_affected_count_check" CHECK ("reports"."affected_count" IN ('1_10', '11_100', '101_1000', '1001_10000', 'over_10000', 'unknown')),
	CONSTRAINT "reports_ongoing_check" CHECK ("reports"."ongoing" IN ('yes', 'no', 'unknown')),
	CONSTRAINT "reports_consents_check" CHECK ("reports"."consents" @> ARRAY['age_18_plus', 'accurate', 'public_issue', 'aggregate_processing']::text[])
);
--> statement-breakpoint
ALTER TABLE "reports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_inviter_id_users_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passkeys" ADD CONSTRAINT "passkeys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "two_factors" ADD CONSTRAINT "two_factors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_reports" ADD CONSTRAINT "issue_reports_issue_fk" FOREIGN KEY ("org_id","issue_id") REFERENCES "public"."issues"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_reports" ADD CONSTRAINT "issue_reports_report_fk" FOREIGN KEY ("org_id","report_id") REFERENCES "public"."reports"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_province_code_regions_code_fk" FOREIGN KEY ("province_code") REFERENCES "public"."regions"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_regency_code_regions_code_fk" FOREIGN KEY ("regency_code") REFERENCES "public"."regions"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_district_code_regions_code_fk" FOREIGN KEY ("district_code") REFERENCES "public"."regions"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_counters" ADD CONSTRAINT "org_counters_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regions" ADD CONSTRAINT "regions_parent_code_regions_code_fk" FOREIGN KEY ("parent_code") REFERENCES "public"."regions"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_report_fk" FOREIGN KEY ("org_id","report_id") REFERENCES "public"."reports"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_contacts" ADD CONSTRAINT "report_contacts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_contacts" ADD CONSTRAINT "report_contacts_report_fk" FOREIGN KEY ("org_id","report_id") REFERENCES "public"."reports"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_province_code_regions_code_fk" FOREIGN KEY ("province_code") REFERENCES "public"."regions"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_regency_code_regions_code_fk" FOREIGN KEY ("regency_code") REFERENCES "public"."regions"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_district_code_regions_code_fk" FOREIGN KEY ("district_code") REFERENCES "public"."regions"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_village_code_regions_code_fk" FOREIGN KEY ("village_code") REFERENCES "public"."regions"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_org_created_idx" ON "audit_log" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("org_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "accounts_user_id_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "invitations_organization_id_idx" ON "invitations" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "invitations_email_idx" ON "invitations" USING btree ("email");--> statement-breakpoint
CREATE INDEX "members_user_id_idx" ON "members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "passkeys_user_id_idx" ON "passkeys" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "passkeys_credential_id_idx" ON "passkeys" USING btree ("credential_id");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "two_factors_user_id_idx" ON "two_factors" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "two_factors_secret_idx" ON "two_factors" USING btree ("secret");--> statement-breakpoint
CREATE INDEX "verifications_identifier_idx" ON "verifications" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "issues_published_idx" ON "issues" USING btree ("org_id","last_activity_at" desc) WHERE "issues"."published_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "regions_parent_code_idx" ON "regions" USING btree ("parent_code");--> statement-breakpoint
CREATE INDEX "evidence_status_idx" ON "evidence" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "reports_queue_idx" ON "reports" USING btree ("org_id","status","created_at");--> statement-breakpoint
CREATE INDEX "reports_user_idx" ON "reports" USING btree ("org_id","user_id","created_at");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "audit_log" AS PERMISSIVE FOR ALL TO public USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "issue_reports" AS PERMISSIVE FOR ALL TO public USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "issues" AS PERMISSIVE FOR ALL TO public USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "org_counters" AS PERMISSIVE FOR ALL TO public USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "evidence" AS PERMISSIVE FOR ALL TO public USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "report_contacts" AS PERMISSIVE FOR ALL TO public USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "staff_only" ON "report_contacts" AS RESTRICTIVE FOR ALL TO public USING (current_setting('app.member_role', true) IN ('moderator', 'admin')) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "reports" AS PERMISSIVE FOR ALL TO public USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);