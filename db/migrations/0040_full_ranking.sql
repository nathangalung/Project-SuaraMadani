-- Full citizen ranking, team request
ALTER TABLE "demand_rankings" DROP CONSTRAINT "demand_rankings_position_check";--> statement-breakpoint
ALTER TABLE "demand_rankings" ADD CONSTRAINT "demand_rankings_position_check" CHECK ("demand_rankings"."position" >= 1) NOT VALID;
