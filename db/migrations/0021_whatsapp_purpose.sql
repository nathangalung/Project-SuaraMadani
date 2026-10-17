-- Daftar WhatsApp budget, per client
ALTER TABLE "whatsapp_log" ADD COLUMN "purpose" text DEFAULT 'sign_in' NOT NULL;--> statement-breakpoint
ALTER TABLE "whatsapp_log" ADD COLUMN "client_hash" text;--> statement-breakpoint
ALTER TABLE "whatsapp_log" ADD CONSTRAINT "whatsapp_log_purpose_check" CHECK ("whatsapp_log"."purpose" IN ('sign_in', 'sign_up')) NOT VALID;
