-- Tuntutan category, citizen importance
CREATE TABLE "demand_ratings" (
	"org_id" uuid NOT NULL,
	"demand_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"score" smallint NOT NULL,
	"show_name" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "demand_ratings_org_id_demand_id_user_id_pk" PRIMARY KEY("org_id","demand_id","user_id"),
	CONSTRAINT "demand_ratings_score_check" CHECK ("demand_ratings"."score" BETWEEN 1 AND 5)
);
--> statement-breakpoint
ALTER TABLE "demand_ratings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "demands" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "demand_ratings" ADD CONSTRAINT "demand_ratings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demand_ratings" ADD CONSTRAINT "demand_ratings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demand_ratings" ADD CONSTRAINT "demand_ratings_demand_fk" FOREIGN KEY ("org_id","demand_id") REFERENCES "public"."demands"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "demand_ratings_user_idx" ON "demand_ratings" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "demands_category_idx" ON "demands" USING btree ("org_id","category") WHERE "demands"."category" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "demands" ADD CONSTRAINT "demands_category_check" CHECK ("demands"."category" IS NULL OR "demands"."category" IN ('pendidikan', 'kesehatan', 'lingkungan_hidup', 'ekonomi_kesejahteraan', 'infrastruktur_transportasi', 'hukum_ham', 'tata_kelola_demokrasi', 'kebencanaan', 'bantuan_sosial')) NOT VALID;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "demand_ratings" AS PERMISSIVE FOR ALL TO public USING (org_id = (SELECT public.current_org_id())) WITH CHECK (org_id = (SELECT public.current_org_id()));--> statement-breakpoint
-- FORCE covers the owner too
ALTER TABLE "demand_ratings" FORCE ROW LEVEL SECURITY;
