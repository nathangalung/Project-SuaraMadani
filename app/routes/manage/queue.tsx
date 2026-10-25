import { requireAdmin } from "~/features/moderation/access.server"
import { QUEUE_STATUSES } from "~/features/moderation/fields"
import { FilterTabs } from "~/features/moderation/filter-tabs"
import { oneOf } from "~/features/moderation/form-values"
import { listQueue } from "~/features/moderation/queue.server"
import { QueueTable } from "~/features/moderation/queue-table"
import { useSiteTitle } from "~/features/report/page-title"
import { REPORT_STATUS_TEXT } from "~/features/report/public-labels"
import { m } from "~/paraglide/messages.js"
import type { Route } from "./+types/queue"

export async function loader({ request, context }: Route.LoaderArgs) {
  const { tenant, role } = await requireAdmin(context)
  const status = oneOf(
    QUEUE_STATUSES,
    new URL(request.url).searchParams.get("status") ?? "",
  )
  return { status, rows: await listQueue(tenant.id, role, status) }
}

export default function Queue({ loaderData }: Route.ComponentProps) {
  const tabs = [
    { key: "", label: m.manage_filter_all(), to: "/kelola/antrean" },
    ...QUEUE_STATUSES.map((status) => ({
      key: status,
      label: REPORT_STATUS_TEXT[status](),
      to: `/kelola/antrean?status=${status}`,
    })),
  ]
  return (
    <div>
      <title>{useSiteTitle(m.manage_queue_title())}</title>
      <h1 className="font-bold font-heading text-3xl [font-synthesis-weight:none]">
        {m.manage_queue_title()}
      </h1>
      <p className="mt-2 mb-6 text-ink-muted">{m.manage_queue_lead()}</p>
      <FilterTabs
        label={m.manage_queue_filter_label()}
        tabs={tabs}
        current={loaderData.status ?? ""}
      />
      <div className="mt-6">
        <QueueTable
          rows={loaderData.rows}
          caption={
            loaderData.status
              ? m.manage_queue_caption_status({
                  status: REPORT_STATUS_TEXT[loaderData.status](),
                })
              : m.manage_queue_caption()
          }
        />
      </div>
    </div>
  )
}
