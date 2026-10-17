-- Unset tenant raises, never empty
CREATE FUNCTION "public"."current_org_id"() RETURNS uuid
  LANGUAGE plpgsql STABLE PARALLEL SAFE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  org text := current_setting('app.org_id', true);
BEGIN
  IF org IS NULL OR org = '' THEN
    RAISE EXCEPTION 'app.org_id is not set' USING
      ERRCODE = 'insufficient_privilege', HINT = 'Run tenant queries inside withTenant';
  END IF;
  RETURN org::uuid;
END
$$;--> statement-breakpoint
DROP INDEX "two_factors_user_id_idx";--> statement-breakpoint
DROP INDEX "issues_published_idx";--> statement-breakpoint
CREATE INDEX "issues_report_count_idx" ON "issues" USING btree ("org_id","report_count" desc,"id" desc) WHERE "issues"."published_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "issues_activity_idx" ON "issues" USING btree ("org_id","last_activity_at" desc,"id" desc);--> statement-breakpoint
CREATE INDEX "evidence_received_idx" ON "evidence" USING btree ("org_id","received_at");--> statement-breakpoint
CREATE INDEX "issues_published_idx" ON "issues" USING btree ("org_id","published_at" desc,"id" desc) WHERE "issues"."published_at" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "two_factors" ADD CONSTRAINT "two_factors_user_id_key" UNIQUE("user_id");--> statement-breakpoint
ALTER POLICY "tenant_isolation" ON "audit_log" TO public USING (org_id = (SELECT public.current_org_id())) WITH CHECK (org_id = (SELECT public.current_org_id()));--> statement-breakpoint
ALTER POLICY "tenant_isolation" ON "issue_reports" TO public USING (org_id = (SELECT public.current_org_id())) WITH CHECK (org_id = (SELECT public.current_org_id()));--> statement-breakpoint
ALTER POLICY "tenant_isolation" ON "issues" TO public USING (org_id = (SELECT public.current_org_id())) WITH CHECK (org_id = (SELECT public.current_org_id()));--> statement-breakpoint
ALTER POLICY "tenant_isolation" ON "org_counters" TO public USING (org_id = (SELECT public.current_org_id())) WITH CHECK (org_id = (SELECT public.current_org_id()));--> statement-breakpoint
ALTER POLICY "tenant_isolation" ON "evidence" TO public USING (org_id = (SELECT public.current_org_id())) WITH CHECK (org_id = (SELECT public.current_org_id()));--> statement-breakpoint
ALTER POLICY "tenant_isolation" ON "report_contacts" TO public USING (org_id = (SELECT public.current_org_id())) WITH CHECK (org_id = (SELECT public.current_org_id()));--> statement-breakpoint
ALTER POLICY "tenant_isolation" ON "reports" TO public USING (org_id = (SELECT public.current_org_id())) WITH CHECK (org_id = (SELECT public.current_org_id()));