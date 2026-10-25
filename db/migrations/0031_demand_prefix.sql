-- Tuntutan prefix cap, PLAN 5.7
ALTER TABLE "demand_ratings" ADD COLUMN "client_hash" text;--> statement-breakpoint
ALTER TABLE "demands" ADD COLUMN "max_prefix_ratings" integer;--> statement-breakpoint
CREATE INDEX "demand_ratings_client_idx" ON "demand_ratings" USING btree ("org_id","demand_id","client_hash") WHERE "demand_ratings"."client_hash" IS NOT NULL;
