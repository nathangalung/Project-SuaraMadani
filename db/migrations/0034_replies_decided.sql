-- Decided replies list, PERF-10
CREATE INDEX "agency_replies_decided_idx" ON "agency_replies" USING btree ("org_id","status","decided_at" desc,"id");
