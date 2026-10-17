-- Withdrawn policy brief timeline row
ALTER TABLE "demand_updates" DROP CONSTRAINT "demand_updates_action_check";--> statement-breakpoint
ALTER TABLE "demand_updates" DROP CONSTRAINT "demand_updates_item_check";--> statement-breakpoint
ALTER TABLE "demand_updates" ADD CONSTRAINT "demand_updates_action_check" CHECK ("demand_updates"."action" IN ('publish', 'close', 'reopen', 'status', 'note', 'brief', 'brief_withdraw')) NOT VALID;--> statement-breakpoint
ALTER TABLE "demand_updates" ADD CONSTRAINT "demand_updates_item_check" CHECK (("demand_updates"."action" IN ('status', 'note', 'brief', 'brief_withdraw')) = ("demand_updates"."item_id" IS NOT NULL)) NOT VALID;
