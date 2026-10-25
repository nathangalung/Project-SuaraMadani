-- Verify runs, ASVS V11.3.3
ALTER TABLE "backup_runs" DROP CONSTRAINT "backup_runs_kind_check";--> statement-breakpoint
ALTER TABLE "backup_runs" ADD CONSTRAINT "backup_runs_kind_check" CHECK ("backup_runs"."kind" IN ('pgbackrest', 'pgbackrest-verify', 'restic', 'b2-copy')) NOT VALID;