import { Link } from "react-router"
import { Badge } from "~/components/ui/badge"
import { PhoneMeta, Table, Td, Th } from "~/components/ui/table"
import { StageMark } from "~/features/issues/issue-status"
import { STAGE_TEXT } from "~/features/issues/labels"
import { requireAdmin } from "~/features/moderation/access.server"
import { ISSUE_NEEDS } from "~/features/moderation/fields"
import { FilterTabs } from "~/features/moderation/filter-tabs"
import { oneOf } from "~/features/moderation/form-values"
import {
  ISSUE_LIST_LIMIT,
  listManagedIssues,
} from "~/features/moderation/overview.server"
import { useSiteTitle } from "~/features/report/page-title"
import { REPORT_STATUS_TEXT } from "~/features/report/public-labels"
import { m } from "~/paraglide/messages.js"
import { formatDate, formatNumber } from "../../../shared/format.ts"
import { PUBLIC_STAGES, publicStage } from "../../../shared/status.ts"
import type { Route } from "./+types/issues"

export async function loader({ request, context }: Route.LoaderArgs) {
  const { tenant, role } = await requireAdmin(context)
  const params = new URL(request.url).searchParams
  // Perlu Tindakan links keep working
  const need = oneOf(ISSUE_NEEDS, params.get("perlu") ?? "")
  const stage = oneOf(PUBLIC_STAGES, params.get("tahap") ?? "")
  const rows = await listManagedIssues(tenant.id, role, need, new Date(), stage)
  return { need, stage, rows, capped: rows.length === ISSUE_LIST_LIMIT }
}

const LINK = "font-semibold text-accent underline underline-offset-4"

type Row = Route.ComponentProps["loaderData"]["rows"][number]

function status(row: Row): string {
  if (!row.published) {
    return row.takenDown
      ? m.manage_issue_taken_down()
      : m.manage_issue_unpublished()
  }
  return STAGE_TEXT[
    publicStage({ advocacy: row.advocacyStatus, government: row.govStatus })
  ]()
}

export default function ManageIssues({ loaderData }: Route.ComponentProps) {
  const { rows, need, stage, capped } = loaderData
  const title = m.manage_issues_title()
  // Jelajah stages, plus admin-only
  const tabs = [
    { key: "", label: m.manage_filter_all(), to: "/kelola/isu" },
    ...PUBLIC_STAGES.map((key) => ({
      key,
      label: STAGE_TEXT[key](),
      to: `/kelola/isu?tahap=${key}`,
    })),
    {
      key: "unverifiable",
      label: REPORT_STATUS_TEXT.unverifiable(),
      to: "/kelola/antrean?status=unverifiable",
    },
  ]
  return (
    <div>
      <title>{useSiteTitle(title)}</title>
      <h1 className="font-bold font-heading text-3xl [font-synthesis-weight:none]">
        {title}
      </h1>
      <p className="mt-2 mb-6 text-ink-muted">{m.manage_issues_lead()}</p>
      <FilterTabs
        label={m.manage_issues_filter_label()}
        tabs={tabs}
        current={stage ?? (need ? "-" : "")}
      />
      <div className="mt-6">
        {rows.length === 0 ? (
          <p>{m.manage_issues_empty()}</p>
        ) : (
          <Table caption={m.manage_issues_caption()}>
            <thead>
              <tr>
                <Th>{m.manage_col_issue()}</Th>
                <Th>{m.manage_col_title()}</Th>
                <Th wide>{m.manage_col_status()}</Th>
                <Th wide numeric>
                  {m.manage_col_reports()}
                </Th>
                <Th wide>{m.manage_col_activity()}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.code}>
                  <Td className="whitespace-nowrap tabular-nums">
                    <Link to={`/kelola/isu/${row.code}`} className={LINK}>
                      {row.code}
                    </Link>
                  </Td>
                  <Td>
                    {row.title}
                    <PhoneMeta>
                      {status(row)},{" "}
                      {m.issue_reports({
                        count: formatNumber(row.reportCount),
                      })}
                      , {formatDate(row.lastActivityAt)}
                    </PhoneMeta>
                  </Td>
                  <Td wide className="text-sm">
                    {row.published ? (
                      <StageMark
                        advocacy={row.advocacyStatus}
                        government={row.govStatus}
                      />
                    ) : (
                      <Badge>
                        {row.takenDown
                          ? m.manage_issue_taken_down()
                          : m.manage_issue_unpublished()}
                      </Badge>
                    )}
                  </Td>
                  <Td wide numeric>
                    {row.reportCount}
                  </Td>
                  <Td wide className="whitespace-nowrap">
                    {formatDate(row.lastActivityAt)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {capped ? (
          <p className="mt-3 text-ink-muted text-sm">
            {m.manage_issues_capped({ count: rows.length })}
          </p>
        ) : null}
      </div>
    </div>
  )
}
