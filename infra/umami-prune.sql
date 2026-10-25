-- Umami rows past 13 months
-- No database FKs, relationMode prisma
BEGIN;
CREATE TEMP TABLE prune_cut ON COMMIT DROP AS
  SELECT now() - interval '13 months' AS at;
DELETE FROM event_data WHERE created_at < (SELECT at FROM prune_cut);
DELETE FROM website_event WHERE created_at < (SELECT at FROM prune_cut);
-- Sessions without events left
DELETE FROM session s WHERE s.created_at < (SELECT at FROM prune_cut)
  AND NOT EXISTS (SELECT 1 FROM website_event e WHERE e.session_id = s.session_id);
DELETE FROM session_data d WHERE d.created_at < (SELECT at FROM prune_cut)
  OR NOT EXISTS (SELECT 1 FROM session s WHERE s.session_id = d.session_id);
DELETE FROM revenue r WHERE r.created_at < (SELECT at FROM prune_cut)
  OR NOT EXISTS (SELECT 1 FROM session s WHERE s.session_id = r.session_id);
DELETE FROM session_link l WHERE l.created_at < (SELECT at FROM prune_cut)
  OR NOT EXISTS (SELECT 1 FROM session s WHERE s.session_id = l.session_id);
DELETE FROM heatmap_event WHERE created_at < (SELECT at FROM prune_cut);
DELETE FROM session_replay WHERE created_at < (SELECT at FROM prune_cut);
COMMIT;
