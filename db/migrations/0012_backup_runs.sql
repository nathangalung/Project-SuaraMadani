CREATE TABLE "backup_runs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "backup_runs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"kind" text NOT NULL,
	"finished_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "backup_runs_kind_check" CHECK ("backup_runs"."kind" IN ('pgbackrest', 'restic', 'b2-copy'))
);
--> statement-breakpoint
CREATE INDEX "backup_runs_kind_finished_idx" ON "backup_runs" USING btree ("kind","finished_at" DESC NULLS LAST);