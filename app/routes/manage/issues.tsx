import { Link } from "react-router"
import { Badge } from "~/components/ui/badge"
import { PhoneMeta, Table, Td, Th } from "~/components/ui/table"
import { ADVOCACY_TEXT, GOVERNMENT_TEXT } from "~/features/issues/labels"
import { requireAdmin } from "~/features/moderation/access.server"
import { ISSUE_NEEDS, type IssueNeed } from "~/features/moderation/fields"
import { FilterTabs } from "~/features/moderation/filter-tabs"
import { oneOf } from "~/features/moderation/form-values"
import {
  ISSUE_LIST_LIMIT,
  listManagedIssues,
} from "~/features/moderation/overview.server"
import { useSiteTitle } from "~/features/report/page-title"
import { m } from "~/paraglide/messages.js"
import { formatDate, formatNumber } from "../../../shared/format.ts"
import type { Route } from "./+types/issues"

export async function loader({ request, context }: Route.LoaderArgs) {
  const { tenant, role } = await requireAdmin(context)
  const need = oneOf(
    ISSUE_NEEDS,
    new URL(request.url).searchParams.get("perlu") ?? "",
  )
  const rows = await listManagedIssues(tenant.id, role, need, new Date())
  return { need, rows, capped: rows.length === ISSUE_LIST_LIMIT }
}

const NEED_LABEL: Record<IssueNeed, () => string> = {
  draf: m.manage_need_draft,
  "belum-diteruskan": m.manage_need_unreferred,
  "lewat-tenggat": m.manage_need_overdue,
  klaim: m.manage_need_claimed,
}

const LINK = "font-semibold text-accent underline underline-offset-4"

type Row = Route.ComponentProps["loaderData"]["rows"][number]

function status(row: Row): string {
  if (!row.published) {
    return row.takenDown
      ? m.manage_issue_taken_down()
      : m.manage_issue_unpublished()
  }
  return `${ADVOCACY_TEXT[row.advocacyStatus]()}, ${GOVERNMENT_TEXT[row.govStatus]().toLowerCase()}`
}

export default function ManageIssues({ loaderData }: Route.ComponentProps) {
  const { rows, need, capped } = loaderData
  const title = m.manage_issues_title()
  const tabs = [
    { key: "", label: m.manage_filter_all(), to: "/kelola/isu" },
    ...ISSUE_NEEDS.map((key) => ({
      key,
      label: NEED_LABEL[key](),
      to: `/kelola/isu?perlu=${key}`,
    })),
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
        current={need ?? ""}
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
                      {status(row)} ·{" "}
                      {m.issue_reports({
                        count: formatNumber(row.reportCount),
                      })}{" "}
                      · {formatDate(row.lastActivityAt)}
                    </PhoneMeta>
                  </Td>
                  <Td wide className="text-sm">
                    {row.published ? (
                      <>
                        {ADVOCACY_TEXT[row.advocacyStatus]()}
                        <span className="block text-ink-muted">
                          {GOVERNMENT_TEXT[row.govStatus]()}
                        </span>
                      </>
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
          <p className="mt-3 font-ui text-ink-muted text-sm">
            {m.manage_issues_capped({ count: rows.length })}
          </p>
        ) : null}
      </div>
    </div>
  )
}
