-- Ranking prefix cap, flag
ALTER TABLE "demands" ADD COLUMN "max_prefix_rankings" integer;--> statement-breakpoint
ALTER TABLE "demand_rankings" ADD COLUMN "client_hash" text;--> statement-breakpoint
CREATE INDEX "demand_rankings_client_idx" ON "demand_rankings" USING btree ("org_id","demand_id","client_hash") WHERE "demand_rankings"."client_hash" IS NOT NULL;
