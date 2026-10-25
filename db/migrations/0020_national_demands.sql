-- Apex tuntutan counts, exact
GRANT SELECT ON public.demands, public.demand_items TO sb_aggregates;--> statement-breakpoint
-- New column needs a rebuild
DROP MATERIALIZED VIEW public.national_aggregates;--> statement-breakpoint
-- NO DATA: migrator is RLS-subject
CREATE MATERIALIZED VIEW public.national_aggregates AS
WITH published AS (
  SELECT i.org_id, i.category_id, i.province_code, i.gov_status, i.report_count
  FROM public.issues i
  WHERE i.published_at IS NOT NULL
),
-- Forwarded reports count once
received AS (
  SELECT r.org_id, count(*)::int AS n
  FROM public.reports r
  WHERE r.status <> 'forwarded'
  GROUP BY r.org_id
),
issue_counts AS (
  SELECT p.org_id, count(*)::int AS n, sum(p.report_count)::int AS merged
  FROM published p
  GROUP BY p.org_id
),
-- Drafts never leave /kelola
public_demands AS (
  SELECT d.id, d.org_id, d.scope, d.state, d.progress
  FROM public.demands d
  WHERE d.state <> 'draft'
),
demand_counts AS (
  SELECT d.org_id, count(*)::int AS n
  FROM public_demands d
  GROUP BY d.org_id
),
item_counts AS (
  SELECT count(*)::int AS n,
    count(*) FILTER (WHERE i.fulfilment_status = 'fulfilled')::int AS fulfilled
  FROM public.demand_items i
  JOIN public_demands d ON d.org_id = i.org_id AND d.id = i.demand_id
),
cells AS (
  SELECT 'campus'::text AS dimension, o.id::text AS key,
    coalesce(rc.n, 0) AS received,
    coalesce(ic.n, 0) AS issues,
    coalesce(ic.merged, 0) AS issue_reports,
    coalesce(dc.n, 0) AS demands
  FROM public.organizations o
  LEFT JOIN received rc ON rc.org_id = o.id
  LEFT JOIN issue_counts ic ON ic.org_id = o.id
  LEFT JOIN demand_counts dc ON dc.org_id = o.id
  UNION ALL
  SELECT 'category', p.category_id, NULL, count(*)::int, sum(p.report_count)::int, NULL
  FROM published p GROUP BY p.category_id
  UNION ALL
  SELECT 'province', p.province_code, NULL, count(*)::int, sum(p.report_count)::int, NULL
  FROM published p GROUP BY p.province_code
  UNION ALL
  SELECT 'status', p.gov_status, NULL, count(*)::int, sum(p.report_count)::int, NULL
  FROM published p GROUP BY p.gov_status
  UNION ALL
  SELECT 'demand', d.scope, NULL, NULL, NULL, count(*)::int
  FROM public_demands d GROUP BY d.scope
  UNION ALL
  SELECT 'demand', 'active', NULL, NULL, NULL, count(*)::int
  FROM public_demands d
  WHERE d.state = 'published' AND d.progress IN ('not_fulfilled', 'partially_fulfilled')
  UNION ALL
  SELECT 'demand', 'fulfilled', NULL, NULL, NULL, count(*)::int
  FROM public_demands d WHERE d.progress = 'fulfilled'
  UNION ALL
  SELECT 'demand', 'items', NULL, NULL, NULL, n FROM item_counts
  UNION ALL
  SELECT 'demand', 'items_fulfilled', NULL, NULL, NULL, fulfilled FROM item_counts
  UNION ALL
  SELECT 'total', 'all',
    (SELECT coalesce(sum(n), 0)::int FROM received),
    (SELECT count(*)::int FROM published),
    (SELECT coalesce(sum(report_count), 0)::int FROM published),
    (SELECT count(*)::int FROM public_demands)
)
-- Starting Values: hide 1–4
SELECT c.dimension, c.key,
  CASE WHEN c.received BETWEEN 1 AND 4 THEN NULL ELSE c.received END AS received,
  CASE WHEN c.issues BETWEEN 1 AND 4 THEN NULL ELSE c.issues END AS issues,
  CASE WHEN c.issue_reports BETWEEN 1 AND 4 THEN NULL ELSE c.issue_reports END AS issue_reports,
  -- Public admin content, exact
  c.demands,
  now() AS computed_at
FROM cells c
WITH NO DATA;--> statement-breakpoint
-- New owner needs CREATE briefly
GRANT CREATE ON SCHEMA public TO sb_aggregates;--> statement-breakpoint
ALTER MATERIALIZED VIEW public.national_aggregates OWNER TO sb_aggregates;--> statement-breakpoint
REVOKE CREATE ON SCHEMA public FROM sb_aggregates;--> statement-breakpoint
-- Runs as owner, all campuses
REFRESH MATERIALIZED VIEW public.national_aggregates;
