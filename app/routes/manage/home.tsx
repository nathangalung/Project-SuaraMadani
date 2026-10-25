import { ChevronRight } from "lucide-react"
import { Link } from "react-router"
import { requireAdmin } from "~/features/moderation/access.server"
import { listAudit, NO_AUDIT_FILTER } from "~/features/moderation/audit.server"
import { AuditTable } from "~/features/moderation/audit-table"
import {
  type IssueNeed,
  QUEUE_STATUSES,
  type QueueStatus,
} from "~/features/moderation/fields"
import { readManageSummary } from "~/features/moderation/overview.server"
import { useSiteTitle } from "~/features/report/page-title"
import { REPORT_STATUS_TEXT } from "~/features/report/public-labels"
import { m } from "~/paraglide/messages.js"
import { formatNumber } from "../../../shared/format.ts"
import type { Route } from "./+types/home"

// Recent audit rows shown
const RECENT = 6

export async function loader({ context }: Route.LoaderArgs) {
  const { tenant, role } = await requireAdmin(context)
  const summary = await readManageSummary(tenant.id, role, new Date())
  const recent = await listAudit(tenant.id, role, NO_AUDIT_FILTER, RECENT)
  return { campus: tenant.campusName, summary, recent: recent.rows }
}

const NOTE: Record<QueueStatus, () => string> = {
  submitted: m.manage_stat_submitted_note,
  unverifiable: m.manage_stat_unverifiable_note,
}

const NEED_TEXT: Record<IssueNeed, (p: { count: string }) => string> = {
  "belum-diteruskan": m.manage_attention_unreferred,
  "lewat-tenggat": m.manage_attention_overdue,
}

const H2 = "font-bold text-2xl"

type Item = {
  key: string
  text: string
  count: number
  to: string
}

function AttentionList({ items }: { items: Item[] }) {
  const open = items.filter((item) => item.count > 0)
  if (open.length === 0) {
    return <p className="mt-3 text-ink-muted">{m.manage_attention_none()}</p>
  }
  return (
    <ul className="mt-4 divide-y divide-line-subtle overflow-hidden rounded-2xl border border-line-subtle bg-surface-raised">
      {open.map((item) => (
        <li key={item.key}>
          <Link
            to={item.to}
            className="group flex min-h-14 items-center justify-between gap-3 px-6 py-4 font-semibold text-ink transition-colors hover:bg-brand-soft"
          >
            <span className="underline-offset-4 group-hover:underline">
              {item.text}
            </span>
            <ChevronRight aria-hidden="true" className="size-5 shrink-0" />
          </Link>
        </li>
      ))}
    </ul>
  )
}

export default function ManageHome({ loaderData }: Route.ComponentProps) {
  const { summary, recent, campus } = loaderData
  const title = m.manage_home_title()
  const items: Item[] = (Object.keys(NEED_TEXT) as IssueNeed[]).map((need) => ({
    key: need,
    text: NEED_TEXT[need]({ count: formatNumber(summary.needs[need]) }),
    count: summary.needs[need],
    to: `/kelola/isu?perlu=${need}`,
  }))
  return (
    <div>
      <title>{useSiteTitle(title)}</title>
      <h1 className="font-bold font-heading text-3xl [font-synthesis-weight:none]">
        {title}
      </h1>
      <p className="mt-2 text-ink-muted">{m.manage_home_lead({ campus })}</p>

      <section aria-labelledby="ringkasan-antrean" className="mt-10">
        <h2 id="ringkasan-antrean" className={H2}>
          {m.manage_queue_title()}
        </h2>
        <ul className="mt-4 grid gap-4 sm:grid-cols-2">
          {QUEUE_STATUSES.map((status) => (
            <li key={status}>
              <Link
                to={`/kelola/antrean?status=${status}`}
                className="flex h-full flex-col-reverse justify-end rounded-2xl border border-line-subtle bg-surface-raised p-6 transition-colors hover:border-brand"
              >
                <span className="mt-3">
                  <span className="block font-semibold text-ink">
                    {REPORT_STATUS_TEXT[status]()}
                  </span>
                  <span className="mt-1 block text-ink-muted text-sm">
                    {NOTE[status]()}
                  </span>
                </span>
                <span className="font-heading text-5xl text-brand tabular-nums leading-none">
                  {formatNumber(summary.counts[status])}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="perlu-tindakan" className="mt-12">
        <h2 id="perlu-tindakan" className={H2}>
          {m.manage_attention_title()}
        </h2>
        <AttentionList items={items} />
      </section>

      {recent.length > 0 ? (
        <section className="mt-12">
          <AuditTable
            caption={<h2 className={H2}>{m.manage_recent_title()}</h2>}
            rows={recent}
          />
          <p className="mt-3">
            <Link
              to="/kelola/audit"
              className="font-semibold text-accent underline underline-offset-4"
            >
              {m.manage_recent_all()}
            </Link>
          </p>
        </section>
      ) : null}
    </div>
  )
}
