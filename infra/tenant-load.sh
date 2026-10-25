#!/usr/bin/env bash
# One tenant export into live
# Args: <export-dir> --confirm [--container NAME]
# Runbook: Restore One Tenant
# One transaction, superuser, keep untouched
set -Eeuo pipefail

# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

DIR="${1:-}"
[[ -n "$DIR" ]] || die "give the export directory"
shift
container=""
confirm=0
while (($#)); do
  case "$1" in
    --confirm) confirm=1 ;;
    --container)
      container="${2:-}"
      [[ -n "$container" ]] || die "--container needs a name"
      shift
      ;;
    *) die "unknown argument $1" ;;
  esac
  shift
done
DB="${TENANT_LOAD_DB:-sadar_bersuara}"
manifest="$DIR/manifest.tsv"
[[ -s "$manifest" && -s "$DIR/org_id" ]] || die "no export in $DIR"
org="$(cat "$DIR/org_id")"
[[ "$org" =~ ^[0-9a-f-]{36}$ ]] || die "bad org_id file"

# Step 2 decision, shown first
after="$(dirname "$DIR")/after-target.txt"
if [[ -f "$after" ]]; then
  printf '== live audit events after the target (%s)\n' "$after"
  cat "$after"
else
  printf '== no %s, read the live audit_log first (runbook step 2)\n' "$after"
fi

# Manifest is input, check it
rows=""
while IFS=$'\t' read -r depth table key count load columns; do
  [[ "$table" == table ]] && continue
  [[ "$depth" =~ ^[0-9]+$ && "$table" =~ ^[a-z_]+$ && "$count" =~ ^[0-9]+$ ]] || die "bad manifest row $table"
  [[ "$key" == org_id || "$key" == organization_id ]] || die "bad key for $table"
  [[ "$load" == replace || "$load" == keep ]] || die "bad load for $table"
  # quote_ident output, keywords quoted
  [[ "$columns" =~ ^(\"?[a-z_][a-z0-9_]*\"?)(,\"?[a-z_][a-z0-9_]*\"?)*$ ]] || die "bad columns for $table"
  [[ ",$columns," == *",$key,"* ]] || die "$table export lacks $key"
  [[ -f "$DIR/$table.copy" ]] || die "missing $table.copy"
  rows+="$table $load $count"$'\n'
done <"$manifest"
printf '== export of %s\n%s' "$org" "$rows"

if ((confirm == 0)); then
  log "nothing loaded, rerun with --confirm after runbook step 2"
  exit 1
fi

if [[ -n "$container" ]]; then
  run_psql() { docker exec -i -u postgres "$container" psql -X -q -v ON_ERROR_STOP=1 -d "$DB"; }
else
  load_env
  run_psql() { compose exec -T -u postgres postgres psql -X -q -v ON_ERROR_STOP=1 -d "$DB"; }
fi

# Data inline, nothing copied over
script() {
  printf 'BEGIN;\n'
  printf "SET LOCAL tenant_load.org = '%s';\n" "$org"
  printf 'DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = %s) THEN RAISE EXCEPTION %s; END IF; END $$;\n' \
    "'$org'" "'tenant-load: tenant $org not in this database'"
  printf 'CREATE TEMP TABLE load_manifest (ord int, tbl text, key text, cols text) ON COMMIT DROP;\n'
  local ord=0
  while IFS=$'\t' read -r _ table key _ load columns; do
    [[ "$load" == replace ]] || continue
    ord=$((ord + 1))
    printf "INSERT INTO load_manifest VALUES (%d, '%s', '%s', '%s');\n" "$ord" "$table" "$key" "$columns"
    printf 'CREATE TEMP TABLE s_%s ON COMMIT DROP AS SELECT %s FROM public.%s WITH NO DATA;\n' "$table" "$columns" "$table"
    # Text escapes, no lone \.
    printf 'COPY s_%s (%s) FROM STDIN WITH (FORMAT text, HEADER MATCH);\n' "$table" "$columns"
    cat "$DIR/$table.copy"
    printf '\\.\nANALYZE s_%s;\n' "$table"
  done <"$manifest"
  cat <<'SQL'
DO $load$
DECLARE
  org uuid := current_setting('tenant_load.org')::uuid;
  rels regclass[];
  m record;
  fk record;
  parent text;
  cond text;
  sets text;
  n bigint;
BEGIN
  SELECT array_agg(format('public.%I', tbl)::regclass ORDER BY ord) INTO rels FROM load_manifest;
  -- Live tables outside the export
  SELECT string_agg(DISTINCT conrelid::regclass::text, ', ') INTO cond FROM pg_constraint
    WHERE contype = 'f' AND confrelid = ANY (rels) AND NOT (conrelid = ANY (rels));
  IF cond IS NOT NULL THEN
    RAISE EXCEPTION 'tenant-load: % reference restored tables, export again', cond;
  END IF;
  FOR m IN SELECT * FROM load_manifest ORDER BY ord LOOP
    EXECUTE format('SELECT count(*) FROM pg_temp.%I WHERE %I IS DISTINCT FROM $1', 's_' || m.tbl, m.key)
      INTO n USING org;
    IF n > 0 THEN
      RAISE EXCEPTION 'tenant-load: % holds % rows of another tenant', m.tbl, n;
    END IF;
    -- Emulate FK actions, parents first
    FOR fk IN
      SELECT c.conname, c.confrelid, c.confdeltype,
        array_agg(a.attname ORDER BY k.i) AS cols,
        array_agg(b.attname ORDER BY k.i) AS refcols,
        (SELECT array_agg(d.attname) FROM unnest(c.confdelsetcols) s(num)
          JOIN pg_attribute d ON d.attrelid = c.conrelid AND d.attnum = s.num) AS setcols
      FROM pg_constraint c
      CROSS JOIN LATERAL unnest(c.conkey, c.confkey) WITH ORDINALITY AS k(ck, rk, i)
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.ck
      JOIN pg_attribute b ON b.attrelid = c.confrelid AND b.attnum = k.rk
      WHERE c.contype = 'f' AND c.conrelid = format('public.%I', m.tbl)::regclass
      GROUP BY c.oid, c.conname, c.conrelid, c.confrelid, c.confdeltype, c.confdelsetcols
      ORDER BY c.conname
    LOOP
      -- Column added after the target
      CONTINUE WHEN NOT fk.cols <@ string_to_array(replace(m.cols, '"', ''), ',')::name[];
      IF fk.confrelid = format('public.%I', m.tbl)::regclass THEN
        RAISE EXCEPTION 'tenant-load: % references itself, not supported', m.tbl;
      ELSIF fk.confrelid = ANY (rels) THEN
        SELECT format('pg_temp.%I', 's_' || relname) INTO parent FROM pg_class WHERE oid = fk.confrelid;
      ELSE
        parent := fk.confrelid::regclass::text;
      END IF;
      SELECT string_agg(format('s.%I IS NOT NULL', col), ' AND ') INTO cond FROM unnest(fk.cols) col;
      cond := cond || format(' AND NOT EXISTS (SELECT 1 FROM %s p WHERE %s)', parent,
        (SELECT string_agg(format('p.%I = s.%I', r, l), ' AND ') FROM unnest(fk.refcols, fk.cols) x(r, l)));
      IF fk.confdeltype IN ('a', 'r', 'c') THEN
        EXECUTE format('DELETE FROM pg_temp.%I s WHERE %s', 's_' || m.tbl, cond);
        GET DIAGNOSTICS n = ROW_COUNT;
        IF n > 0 THEN
          RAISE NOTICE 'tenant-load: % drop % %', m.tbl, array_to_string(fk.cols, ','), n;
        END IF;
      ELSIF fk.confdeltype = 'n' THEN
        SELECT string_agg(format('%I = NULL', col), ', ') INTO sets FROM unnest(coalesce(fk.setcols, fk.cols)) col;
        EXECUTE format('UPDATE pg_temp.%I s SET %s WHERE %s', 's_' || m.tbl, sets, cond);
        GET DIAGNOSTICS n = ROW_COUNT;
        IF n > 0 THEN
          RAISE NOTICE 'tenant-load: % null % %', m.tbl, array_to_string(coalesce(fk.setcols, fk.cols), ','), n;
        END IF;
      ELSE
        RAISE EXCEPTION 'tenant-load: % on % uses SET DEFAULT, not supported', fk.conname, m.tbl;
      END IF;
    END LOOP;
    -- Never send twice, runbook
    IF m.tbl = 'notifications' THEN
      UPDATE pg_temp.s_notifications SET status = 'skipped', error = 'restored'
        WHERE status NOT IN ('sent', 'failed', 'skipped');
      GET DIAGNOSTICS n = ROW_COUNT;
      RAISE NOTICE 'tenant-load: notifications restored %', n;
    END IF;
  END LOOP;
  FOR m IN SELECT * FROM load_manifest ORDER BY ord DESC LOOP
    EXECUTE format('DELETE FROM public.%I WHERE %I = $1', m.tbl, m.key) USING org;
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'tenant-load: % deleted %', m.tbl, n;
  END LOOP;
  FOR m IN SELECT * FROM load_manifest ORDER BY ord LOOP
    EXECUTE format('INSERT INTO public.%I (%s) SELECT %s FROM pg_temp.%I', m.tbl, m.cols, m.cols, 's_' || m.tbl);
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'tenant-load: % inserted %', m.tbl, n;
  END LOOP;
END
$load$;
COMMIT;
SQL
}

log "loading $org into $DB"
script | run_psql 2>&1 | sed 's/^NOTICE:  //'
log "loaded, continue with runbook step 5"
