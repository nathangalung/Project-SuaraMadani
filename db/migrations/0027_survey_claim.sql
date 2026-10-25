-- Survey mail names its round
ALTER TABLE "notifications" ADD COLUMN "claim_id" uuid;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_claim_fk" FOREIGN KEY ("org_id","claim_id") REFERENCES "public"."resolution_claims"("org_id","id") ON DELETE cascade ON UPDATE no action NOT VALID;--> statement-breakpoint
CREATE INDEX "notifications_claim_idx" ON "notifications" USING btree ("org_id","claim_id") WHERE "notifications"."claim_id" IS NOT NULL;--> statement-breakpoint
-- Owner bypass for the backfill
ALTER TABLE "notifications" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "resolution_claims" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- Round sent nearest the mail
UPDATE "notifications" n SET "claim_id" = (
  SELECT c."id" FROM "resolution_claims" c
  WHERE c."org_id" = n."org_id" AND c."issue_id" = n."issue_id" AND c."survey_sent_at" IS NOT NULL
  ORDER BY abs(extract(epoch FROM c."survey_sent_at" - n."created_at")), c."id" LIMIT 1)
WHERE n."template" = 'claim_survey' AND n."claim_id" IS NULL;--> statement-breakpoint
ALTER TABLE "notifications" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "resolution_claims" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_claim_check" CHECK (("notifications"."template" IN ('claim_survey')) = ("notifications"."claim_id" IS NOT NULL)) NOT VALID;
