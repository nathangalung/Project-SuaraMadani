-- Moderators become admins
UPDATE "members" SET "role" = 'admin' WHERE "role" = 'moderator';--> statement-breakpoint
UPDATE "invitations" SET "role" = 'admin' WHERE "role" = 'moderator';--> statement-breakpoint
ALTER TABLE "invitations" DROP CONSTRAINT "invitations_role_check";--> statement-breakpoint
ALTER TABLE "members" DROP CONSTRAINT "members_role_check";--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_role_check" CHECK ("invitations"."role" IN ('reporter', 'editor', 'admin')) NOT VALID;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_role_check" CHECK ("members"."role" IN ('reporter', 'editor', 'admin')) NOT VALID;--> statement-breakpoint
ALTER POLICY "staff_only" ON "redaction_originals" TO public USING (current_setting('app.member_role', true) = 'admin') WITH CHECK (current_setting('app.member_role', true) = 'admin');--> statement-breakpoint
ALTER POLICY "staff_only" ON "report_contacts" TO public USING (current_setting('app.member_role', true) = 'admin') WITH CHECK (true);
