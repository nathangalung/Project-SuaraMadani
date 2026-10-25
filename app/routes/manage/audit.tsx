import { Form, Link } from "react-router"
import { Button } from "~/components/ui/button"
import { TextInput } from "~/components/ui/field"
import { Note } from "~/components/ui/note"
import { Select } from "~/components/ui/select"
import { requireAdmin } from "~/features/moderation/access.server"
import { listAudit, parseAuditQuery } from "~/features/moderation/audit.server"
import { AuditTable } from "~/features/moderation/audit-table"
import { AUDIT_ACTION_TEXT, ENTITY_TEXT } from "~/features/moderation/labels"
import { useSiteTitle } from "~/features/report/page-title"
import { m } from "~/paraglide/messages.js"
import { AUDIT_ACTIONS, AUDIT_ENTITIES } from "../../../shared/moderation.ts"
import type { Route } from "./+types/audit"

export async function loader({ request, context }: Route.LoaderArgs) {
  const { tenant, role } = await requireAdmin(context)
  const params = new URL(request.url).searchParams
  const query = parseAuditQuery(params)
  // An inverted range finds nothing
  const inverted = Boolean(query.from && query.to && query.to < query.from)
  const page = inverted
    ? { rows: [], next: null }
    : await listAudit(tenant.id, role, query)
  // Older page keeps the filters
  const older = new URLSearchParams(params)
  if (page.next) older.set("sebelum", page.next)
  return {
    query,
    inverted,
    rows: page.rows,
    olderHref: page.next ? `/kelola/audit?${older}` : null,
    filtered: [...params.keys()].some((key) => key !== "sebelum"),
  }
}

export default function Audit({ loaderData }: Route.ComponentProps) {
  const { query, rows, olderHref, inverted, filtered } = loaderData
  const title = m.manage_audit_title()
  return (
    <div>
      <title>{useSiteTitle(title)}</title>
      <h1 className="font-bold font-heading text-3xl [font-synthesis-weight:none]">
        {title}
      </h1>
      <p className="mt-2 mb-6 text-ink-muted">{m.manage_audit_lead()}</p>
      <Form
        method="get"
        className="grid gap-4 rounded-2xl border border-line-subtle bg-surface-raised p-6 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_auto] lg:items-end"
      >
        <Select
          id="audit-action"
          name="tindakan"
          label={m.manage_audit_action()}
          defaultValue={query.action ?? ""}
        >
          <option value="">{m.manage_filter_all()}</option>
          {AUDIT_ACTIONS.map((action) => (
            <option key={action} value={action}>
              {AUDIT_ACTION_TEXT[action]()}
            </option>
          ))}
        </Select>
        <Select
          id="audit-entity"
          name="data"
          label={m.manage_audit_entity()}
          defaultValue={query.entity ?? ""}
        >
          <option value="">{m.manage_filter_all()}</option>
          {AUDIT_ENTITIES.map((entity) => (
            <option key={entity} value={entity}>
              {ENTITY_TEXT[entity]()}
            </option>
          ))}
        </Select>
        <TextInput
          id="audit-from"
          name="dari"
          type="date"
          label={m.manage_audit_from()}
          defaultValue={query.from ?? ""}
        />
        <TextInput
          id="audit-to"
          name="sampai"
          type="date"
          label={m.manage_audit_to()}
          defaultValue={query.to ?? ""}
        />
        <Button type="submit" variant="secondary">
          {m.manage_audit_apply()}
        </Button>
      </Form>
      {filtered ? (
        <p className="mt-3">
          <Link
            to="/kelola/audit"
            className="font-semibold text-accent underline underline-offset-4"
          >
            {m.manage_audit_reset()}
          </Link>
        </p>
      ) : null}
      <div className="mt-8">
        {inverted ? (
          <Note>{m.manage_audit_range_error()}</Note>
        ) : rows.length === 0 ? (
          <p>{m.manage_audit_empty()}</p>
        ) : (
          <AuditTable caption={m.manage_audit_caption()} rows={rows} />
        )}
      </div>
      {olderHref ? (
        <p className="mt-6">
          <Link
            to={olderHref}
            className="font-semibold text-accent underline underline-offset-4"
          >
            {m.manage_audit_older()}
          </Link>
        </p>
      ) : null}
    </div>
  )
}
