-- Phone sign-in, WhatsApp sender
CREATE TABLE "whatsapp_auth" (
	"key" text PRIMARY KEY NOT NULL,
	"value" "bytea" NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whatsapp_log" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"phone_hash" text NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "whatsapp_log_status_check" CHECK ("whatsapp_log"."status" IN ('reserved', 'sent', 'failed')),
	CONSTRAINT "whatsapp_log_error_check" CHECK ("whatsapp_log"."error" IN ('expired', 'unavailable', 'not_on_whatsapp', 'provider'))
);
--> statement-breakpoint
CREATE TABLE "whatsapp_sender" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"provider" text NOT NULL,
	"status" text NOT NULL,
	"requested" text,
	"requested_by" uuid,
	"pairing_phone" text,
	"qr" text,
	"pairing_code" text,
	"linked_phone" text,
	"last_connected_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_sender_singleton_check" CHECK ("whatsapp_sender"."id" = 1),
	CONSTRAINT "whatsapp_sender_status_check" CHECK ("whatsapp_sender"."status" IN ('unlinked', 'linking', 'connected', 'disconnected', 'logged_out')),
	CONSTRAINT "whatsapp_sender_requested_check" CHECK ("whatsapp_sender"."requested" IN ('link_qr', 'link_code', 'unlink'))
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "phone_number" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "phone_verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "whatsapp_sender" ADD CONSTRAINT "whatsapp_sender_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "whatsapp_log_created_idx" ON "whatsapp_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "whatsapp_log_phone_idx" ON "whatsapp_log" USING btree ("phone_hash","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_phone_number_key" ON "users" USING btree ("phone_number");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_phone_number_key" UNIQUE USING INDEX "users_phone_number_key";--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_phone_number_check" CHECK ("users"."phone_number" ~ '^\+628[0-9]{8,11}$') NOT VALID;