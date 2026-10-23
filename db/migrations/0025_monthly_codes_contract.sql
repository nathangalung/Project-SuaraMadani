-- Monthly LPR and ISU codes
ALTER TABLE "issues" ADD COLUMN "month" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "org_counters" ADD COLUMN "month" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "issues_number_month_idx" ON "issues" ("org_id","year","month","number");--> statement-breakpoint
ALTER TABLE "issues" DROP CONSTRAINT "issues_number_key";--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_number_key" UNIQUE USING INDEX "issues_number_month_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "org_counters_month_pk_idx" ON "org_counters" ("org_id","year","month","kind");--> statement-breakpoint
ALTER TABLE "org_counters" DROP CONSTRAINT "org_counters_org_id_year_kind_pk";--> statement-breakpoint
ALTER TABLE "org_counters" ADD CONSTRAINT "org_counters_org_id_year_month_kind_pk" PRIMARY KEY USING INDEX "org_counters_month_pk_idx";--> statement-breakpoint
ALTER TABLE "org_counters" DROP CONSTRAINT "org_counters_kind_check";--> statement-breakpoint
ALTER TABLE "org_counters" ADD CONSTRAINT "org_counters_kind_check" CHECK ("org_counters"."kind" IN ('issue', 'demand', 'report')) NOT VALID;--> statement-breakpoint
ALTER TABLE "org_counters" VALIDATE CONSTRAINT "org_counters_kind_check";
