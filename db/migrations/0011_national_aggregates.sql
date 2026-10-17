-- Apex national view, PLAN 5.11
-- Owner sm_aggregates bypasses RLS
GRANT USAGE ON SCHEMA public TO sm_aggregates;--> statement-breakpoint
GRANT SELECT ON public.organizations, public.issues, public.reports TO sm_aggregates;--> statement-breakpoint
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
cells AS (
  SELECT 'campus'::text AS dimension, o.id::text AS key,
    coalesce(rc.n, 0) AS received,
    coalesce(ic.n, 0) AS issues,
    coalesce(ic.merged, 0) AS issue_reports
  FROM public.organizations o
  LEFT JOIN received rc ON rc.org_id = o.id
  LEFT JOIN issue_counts ic ON ic.org_id = o.id
  UNION ALL
  SELECT 'category', p.category_id, NULL, count(*)::int, sum(p.report_count)::int
  FROM published p GROUP BY p.category_id
  UNION ALL
  SELECT 'province', p.province_code, NULL, count(*)::int, sum(p.report_count)::int
  FROM published p GROUP BY p.province_code
  UNION ALL
  SELECT 'status', p.gov_status, NULL, count(*)::int, sum(p.report_count)::int
  FROM published p GROUP BY p.gov_status
  UNION ALL
  SELECT 'total', 'all',
    (SELECT coalesce(sum(n), 0)::int FROM received),
    (SELECT count(*)::int FROM published),
    (SELECT coalesce(sum(report_count), 0)::int FROM published)
)
-- Starting Values: hide 1–4
SELECT c.dimension, c.key,
  CASE WHEN c.received BETWEEN 1 AND 4 THEN NULL ELSE c.received END AS received,
  CASE WHEN c.issues BETWEEN 1 AND 4 THEN NULL ELSE c.issues END AS issues,
  CASE WHEN c.issue_reports BETWEEN 1 AND 4 THEN NULL ELSE c.issue_reports END AS issue_reports,
  now() AS computed_at
FROM cells c
WITH NO DATA;--> statement-breakpoint
-- New owner needs CREATE briefly
GRANT CREATE ON SCHEMA public TO sm_aggregates;--> statement-breakpoint
ALTER MATERIALIZED VIEW public.national_aggregates OWNER TO sm_aggregates;--> statement-breakpoint
REVOKE CREATE ON SCHEMA public FROM sm_aggregates;--> statement-breakpoint
-- Runs as owner, all campuses
REFRESH MATERIALIZED VIEW public.national_aggregates;
