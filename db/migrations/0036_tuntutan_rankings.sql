-- Citizen tuntutan rankings, top 5
CREATE TABLE "demand_rankings" (
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"demand_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "demand_rankings_org_id_user_id_demand_id_pk" PRIMARY KEY("org_id","user_id","demand_id"),
	CONSTRAINT "demand_rankings_position_key" UNIQUE("org_id","user_id","position"),
	CONSTRAINT "demand_rankings_position_check" CHECK ("demand_rankings"."position" BETWEEN 1 AND 5)
);
--> statement-breakpoint
ALTER TABLE "demand_rankings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "demand_rankings" ADD CONSTRAINT "demand_rankings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demand_rankings" ADD CONSTRAINT "demand_rankings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demand_rankings" ADD CONSTRAINT "demand_rankings_demand_fk" FOREIGN KEY ("org_id","demand_id") REFERENCES "public"."demands"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "demand_rankings_demand_idx" ON "demand_rankings" USING btree ("org_id","demand_id");--> statement-breakpoint
CREATE INDEX "demand_rankings_user_idx" ON "demand_rankings" USING btree ("user_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "demand_rankings" AS PERMISSIVE FOR ALL TO public USING (org_id = (SELECT public.current_org_id())) WITH CHECK (org_id = (SELECT public.current_org_id()));--> statement-breakpoint
ALTER TABLE "demand_rankings" FORCE ROW LEVEL SECURITY;