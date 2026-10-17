import { Plus } from "lucide-react"
import { Link, useSearchParams } from "react-router"
import { Badge } from "~/components/ui/badge"
import { ButtonLink } from "~/components/ui/button"
import { Note } from "~/components/ui/note"
import { PhoneMeta, Table, Td, Th } from "~/components/ui/table"
import { SCOPE_TEXT, STATE_TEXT } from "~/features/demands/labels"
import {
  DEMAND_LIST_LIMIT,
  listManagedDemands,
} from "~/features/demands/manage.server"
import { requireAdmin } from "~/features/moderation/access.server"
import { useSiteTitle } from "~/features/report/page-title"
import { m } from "~/paraglide/messages.js"
import { formatDate } from "../../../shared/format.ts"
import type { Route } from "./+types/demands"

export async function loader({ context }: Route.LoaderArgs) {
  const { tenant } = await requireAdmin(context)
  const rows = await listManagedDemands(tenant.id)
  return { rows, capped: rows.length === DEMAND_LIST_LIMIT }
}

const LINK = "font-semibold text-accent underline underline-offset-4"

export default function ManageDemands({ loaderData }: Route.ComponentProps) {
  const { rows, capped } = loaderData
  const [params] = useSearchParams()
  const title = m.manage_demands_title()
  return (
    <div>
      <title>{useSiteTitle(title)}</title>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-bold font-heading text-3xl [font-synthesis-weight:none]">
            {title}
          </h1>
          <p className="mt-2 max-w-2xl text-ink-muted">
            {m.manage_demands_lead()}
          </p>
        </div>
        <ButtonLink to="/kelola/tuntutan/baru">
          <Plus aria-hidden="true" className="size-4" />
          {m.demand_new_button()}
        </ButtonLink>
      </div>
      {params.get("dihapus") ? (
        <Note tone="success" className="mt-6">
          <p role="status">{m.demand_deleted()}</p>
        </Note>
      ) : null}
      <div className="mt-6">
        {rows.length === 0 ? (
          <p>{m.manage_demands_empty()}</p>
        ) : (
          <Table caption={m.manage_demands_caption()}>
            <thead>
              <tr>
                <Th>{m.mail_fact_demand_code()}</Th>
                <Th>{m.demand_field_title()}</Th>
                <Th wide>{m.demands_filter_scope()}</Th>
                <Th wide>{m.manage_demands_col_state()}</Th>
                <Th wide>{m.demands_col_fulfilment()}</Th>
                <Th wide>{m.manage_col_activity()}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.code}>
                  <Td className="whitespace-nowrap align-middle tabular-nums">
                    <Link to={`/kelola/tuntutan/${row.code}`} className={LINK}>
                      {row.code}
                    </Link>
                  </Td>
                  <Td className="align-middle">
                    {row.title}
                    <PhoneMeta>
                      {[
                        STATE_TEXT[row.state](),
                        row.provinceName ?? SCOPE_TEXT[row.scope](),
                        m.demand_progress_line({
                          done: row.fulfilled,
                          total: row.items,
                        }),
                        formatDate(row.lastActivityAt),
                      ].join(" · ")}
                    </PhoneMeta>
                  </Td>
                  <Td wide className="align-middle text-sm">
                    {SCOPE_TEXT[row.scope]()}
                    {row.provinceName ? (
                      <span className="block text-ink-muted">
                        {row.provinceName}
                      </span>
                    ) : null}
                  </Td>
                  <Td wide className="align-middle">
                    <Badge
                      tone={row.state === "published" ? "soft" : "neutral"}
                    >
                      {STATE_TEXT[row.state]()}
                    </Badge>
                  </Td>
                  <Td wide className="align-middle text-sm">
                    {m.demand_progress_line({
                      done: row.fulfilled,
                      total: row.items,
                    })}
                  </Td>
                  <Td wide className="whitespace-nowrap align-middle">
                    {formatDate(row.lastActivityAt)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {capped ? (
          <p className="mt-3 font-ui text-ink-muted text-sm">
            {m.manage_issues_capped({ count: rows.length })}
          </p>
        ) : null}
      </div>
    </div>
  )
}
