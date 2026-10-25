-- Brief links, team request
ALTER TABLE "demand_items" ADD COLUMN "brief_url" text;--> statement-breakpoint
ALTER TABLE "demands" ADD COLUMN "brief_url" text;--> statement-breakpoint
ALTER TABLE "demand_items" ADD CONSTRAINT "demand_items_brief_url_check" CHECK ("demand_items"."brief_url" IS NULL OR ("demand_items"."brief_url" ~ '^https?://' AND length("demand_items"."brief_url") <= 500)) NOT VALID;--> statement-breakpoint
ALTER TABLE "demands" ADD CONSTRAINT "demands_brief_url_check" CHECK ("demands"."brief_url" IS NULL OR ("demands"."brief_url" ~ '^https?://' AND length("demands"."brief_url") <= 500)) NOT VALID;