-- Daftar share, slots, WhatsApp stop
ALTER TABLE "whatsapp_sender" DROP CONSTRAINT "whatsapp_sender_status_check";--> statement-breakpoint
ALTER TABLE "email_log" ADD COLUMN "purpose" text;--> statement-breakpoint
ALTER TABLE "email_log" ADD COLUMN "client_hash" text;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "email_log_id" uuid;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_email_log_id_email_log_id_fk" FOREIGN KEY ("email_log_id") REFERENCES "public"."email_log"("id") ON DELETE set null ON UPDATE no action NOT VALID;--> statement-breakpoint
CREATE INDEX "notifications_email_log_idx" ON "notifications" USING btree ("email_log_id") WHERE "notifications"."email_log_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "email_log" ADD CONSTRAINT "email_log_purpose_check" CHECK ("email_log"."purpose" IN ('sign_in', 'sign_up')) NOT VALID;--> statement-breakpoint
ALTER TABLE "whatsapp_sender" ADD CONSTRAINT "whatsapp_sender_status_check" CHECK ("whatsapp_sender"."status" IN ('unlinked', 'linking', 'connected', 'disconnected', 'logged_out', 'stopped')) NOT VALID;