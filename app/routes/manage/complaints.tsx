import { Link } from "react-router"
import { Badge } from "~/components/ui/badge"
import { PhoneMeta, Table, Td, Th } from "~/components/ui/table"
import { requireAdmin } from "~/features/moderation/access.server"
import {
  COMPLAINT_REASON_TEXT,
  COMPLAINT_STATUS_TEXT,
} from "~/features/moderation/complaint-labels"
import {
  COMPLAINT_LIST_LIMIT,
  listComplaints,
} from "~/features/moderation/complaints.server"
import {
  COMPLAINT_FILTERS,
  type ComplaintFilter,
} from "~/features/moderation/fields"
import { FilterTabs } from "~/features/moderation/filter-tabs"
import { oneOf } from "~/features/moderation/form-values"
import { useSiteTitle } from "~/features/report/page-title"
import { m } from "~/paraglide/messages.js"
import { formatDate } from "../../../shared/format.ts"
import type { Route } from "./+types/complaints"

const ALL = "semua"

export async function loader({ request, context }: Route.LoaderArgs) {
  const { tenant, role } = await requireAdmin(context)
  const param = new URL(request.url).searchParams.get("status") ?? "baru"
  const filter = param === ALL ? null : oneOf(COMPLAINT_FILTERS, param)
  const current = filter ?? ALL
  const rows = await listComplaints(tenant.id, role, filter)
  return { current, rows, capped: rows.length === COMPLAINT_LIST_LIMIT }
}

const FILTER_LABEL: Record<ComplaintFilter, () => string> = {
  baru: m.manage_complaints_filter_open,
  banding: m.manage_complaints_filter_appealed,
  selesai: m.manage_complaints_filter_done,
}

const LINK = "font-semibold text-accent underline underline-offset-4"

export default function ManageComplaints({ loaderData }: Route.ComponentProps) {
  const { rows, current, capped } = loaderData
  const title = m.manage_complaints_title()
  const tabs = [
    ...COMPLAINT_FILTERS.map((key) => ({
      key,
      label: FILTER_LABEL[key](),
      to: `/kelola/aduan?status=${key}`,
    })),
    {
      key: ALL,
      label: m.manage_filter_all(),
      to: `/kelola/aduan?status=${ALL}`,
    },
  ]
  return (
    <div>
      <title>{useSiteTitle(title)}</title>
      <h1 className="font-bold font-heading text-3xl [font-synthesis-weight:none]">
        {title}
      </h1>
      <p className="mt-2 mb-6 text-ink-muted">{m.manage_complaints_lead()}</p>
      <FilterTabs
        label={m.manage_complaints_filter_label()}
        tabs={tabs}
        current={current}
      />
      <div className="mt-6">
        {rows.length === 0 ? (
          <p>{m.manage_complaints_empty()}</p>
        ) : (
          <Table caption={m.manage_complaints_caption()}>
            <thead>
              <tr>
                <Th>{m.manage_col_complaint()}</Th>
                <Th>{m.manage_col_complaint_subject()}</Th>
                <Th wide>{m.manage_col_complaint_reason()}</Th>
                <Th wide>{m.manage_col_received()}</Th>
                <Th wide>{m.manage_col_status()}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.code}>
                  <Td className="whitespace-nowrap tabular-nums">
                    <Link to={`/kelola/aduan/${row.code}`} className={LINK}>
                      {row.code}
                    </Link>
                  </Td>
                  <Td>
                    <span className="block whitespace-nowrap text-sm tabular-nums">
                      {row.subject.code}
                    </span>
                    {row.subject.title}
                    <PhoneMeta>
                      {COMPLAINT_STATUS_TEXT[row.status]()} ·{" "}
                      {COMPLAINT_REASON_TEXT[row.reason]()} ·{" "}
                      {formatDate(row.createdAt)}
                    </PhoneMeta>
                  </Td>
                  <Td wide className="text-sm">
                    {COMPLAINT_REASON_TEXT[row.reason]()}
                  </Td>
                  <Td wide className="whitespace-nowrap">
                    {formatDate(row.createdAt)}
                  </Td>
                  <Td wide>
                    <Badge
                      tone={
                        row.status === "open" || row.status === "appealed"
                          ? "brand"
                          : "neutral"
                      }
                    >
                      {COMPLAINT_STATUS_TEXT[row.status]()}
                    </Badge>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {capped ? (
          <p className="mt-3 text-ink-muted text-sm">
            {m.manage_complaints_capped({ count: rows.length })}
          </p>
        ) : null}
      </div>
    </div>
  )
}
