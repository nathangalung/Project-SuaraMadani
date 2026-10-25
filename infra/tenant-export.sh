#!/usr/bin/env bash
# One tenant to COPY files
# Usage: tenant-export.sh <container> <slug> <out-dir>
# Reads only, any cluster
set -Eeuo pipefail

CONTAINER="${1:?postgres container}"
SLUG="${2:?tenant slug}"
OUT="${3:?output directory}"
DB="${TENANT_EXPORT_DB:-sadar_bersuara}"
# Live rows win, runbook
KEEP=" audit_log org_counters members invitations "

[[ "$SLUG" =~ ^[a-z0-9-]+$ ]] || { echo "tenant-export: bad slug" >&2; exit 2; }

psql_at() {
  docker exec -i -u postgres "$CONTAINER" psql -X -At -v ON_ERROR_STOP=1 -d "$DB" "$@"
}

org="$(psql_at -c "SELECT id FROM organizations WHERE slug = '$SLUG'")"
[[ "$org" =~ ^[0-9a-f-]{36}$ ]] || { echo "tenant-export: no tenant $SLUG" >&2; exit 1; }

# Tenant tables: a tenant key
TENANT="SELECT c.oid AS rel FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
  WHERE c.relkind = 'r' AND c.relname <> 'organizations' AND EXISTS (
    SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND NOT a.attisdropped
      AND a.attname IN ('org_id', 'organization_id'))"

# Unscoped rows would dangle
outside="$(psql_at -c "SELECT string_agg(DISTINCT conrelid::regclass::text, ', ')
  FROM pg_constraint WHERE contype = 'f'
    AND confrelid IN ($TENANT) AND conrelid NOT IN ($TENANT)")"
[[ -z "$outside" ]] || { echo "tenant-export: $outside reference tenant rows without a tenant key" >&2; exit 1; }

# Parents first, FK depth
tables="$(psql_at -F $'\t' <<SQL
WITH RECURSIVE tenant AS ($TENANT), edge AS (
  SELECT DISTINCT c.conrelid AS child, c.confrelid AS parent
  FROM pg_constraint c
  JOIN tenant a ON a.rel = c.conrelid
  JOIN tenant b ON b.rel = c.confrelid
  WHERE c.contype = 'f' AND c.conrelid <> c.confrelid
), depth AS (
  SELECT rel, 0 AS d FROM tenant
  UNION ALL
  SELECT e.child, depth.d + 1 FROM edge e JOIN depth ON depth.rel = e.parent
)
SELECT max(d), c.relname,
  CASE WHEN EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = c.oid AND attname = 'org_id')
    THEN 'org_id' ELSE 'organization_id' END,
  (SELECT string_agg(quote_ident(attname), ',' ORDER BY attnum) FROM pg_attribute
    WHERE attrelid = c.oid AND attnum > 0 AND NOT attisdropped AND attgenerated = '')
FROM depth JOIN pg_class c ON c.oid = depth.rel
GROUP BY c.oid, c.relname
ORDER BY 1, 2
SQL
)"

install -d -m 0700 "$OUT"
manifest="$OUT/manifest.tsv"
printf 'depth\ttable\tkey\trows\tload\tcolumns\n' >"$manifest"
while IFS=$'\t' read -r depth table key columns; do
  # Text escapes CR, LF, backslash
  psql_at -c "\\copy (SELECT $columns FROM public.$table WHERE $key = '$org') TO STDOUT WITH (FORMAT text, HEADER)" </dev/null >"$OUT/$table.copy"
  rows="$(psql_at -c "SELECT count(*) FROM public.$table WHERE $key = '$org'" </dev/null)"
  load=replace
  [[ "$KEEP" == *" $table "* ]] && load=keep
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$depth" "$table" "$key" "$rows" "$load" "$columns" >>"$manifest"
done <<<"$tables"
printf '%s\n' "$org" >"$OUT/org_id"
echo "tenant-export: $SLUG ($org), $(($(wc -l <"$manifest") - 1)) tables in $OUT"
