-- Staff idle timeout, V7.3.1
ALTER TABLE "sessions" ADD COLUMN "last_seen_at" timestamp with time zone;