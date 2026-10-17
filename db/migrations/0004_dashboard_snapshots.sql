CREATE TABLE "dashboard_snapshots" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"data" jsonb NOT NULL,
	"computed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dashboard_snapshots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "dashboard_snapshots" ADD CONSTRAINT "dashboard_snapshots_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "dashboard_snapshots" AS PERMISSIVE FOR ALL TO public USING (org_id = (SELECT public.current_org_id())) WITH CHECK (org_id = (SELECT public.current_org_id()));--> statement-breakpoint
-- FORCE covers the owner too
ALTER TABLE "dashboard_snapshots" FORCE ROW LEVEL SECURITY;