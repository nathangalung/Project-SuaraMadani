import type { ReactNode } from "react"
import { Link } from "react-router"
import { PhoneMeta, Table, Td, Th } from "~/components/ui/table"
import { m } from "~/paraglide/messages.js"
import { formatDateTime } from "../../../shared/format.ts"
import type { AuditEntity } from "../../../shared/moderation.ts"
import type { AuditRow } from "./audit.server"
import { auditColumnText, auditReasonText } from "./audit-labels"
import { AUDIT_ACTION_TEXT, ENTITY_TEXT, ROLE_TEXT } from "./labels"

const LINK = "font-semibold text-accent underline underline-offset-4"

function actionText(action: string): string {
  return Object.hasOwn(AUDIT_ACTION_TEXT, action)
    ? AUDIT_ACTION_TEXT[action as keyof typeof AUDIT_ACTION_TEXT]()
    : action
}

// Team rows name no person
function teamEntity(row: AuditRow): AuditEntity | null {
  const { entityType } = row
  if (entityType === "organization" || entityType === "invitation") {
    return entityType
  }
  return entityType === "user" && row.action.startsWith("member.")
    ? "user"
    : null
}

function Entity({ row }: { row: AuditRow }) {
  const team = teamEntity(row)
  if (team) {
    const label = ENTITY_TEXT[team]()
    return team === "organization" || !row.entityShort ? (
      label
    ) : (
      <>
        {label}{" "}
        <span className="font-ui text-ink-muted text-sm">
          {row.entityShort}
        </span>
      </>
    )
  }
  if (!row.entityCode) {
    return <span className="text-ink-muted">{m.manage_audit_deleted()}</span>
  }
  const path =
    row.entityType === "issue"
      ? "isu"
      : row.entityType === "complaint"
        ? "aduan"
        : "laporan"
  return (
    <Link to={`/kelola/${path}/${row.entityCode}`} className={LINK}>
      {row.entityCode}
    </Link>
  )
}

// Reporter ids stay hidden
function Actor({ row }: { row: AuditRow }) {
  if (!row.actorRole) {
    return <span className="text-ink-muted">{m.manage_actor_other()}</span>
  }
  const role = ROLE_TEXT[row.actorRole]()
  return row.actorRole === "reporter" || !row.actorShort ? (
    role
  ) : (
    <>
      {role}{" "}
      <span className="font-ui text-ink-muted text-sm tabular-nums">
        {row.actorShort}
      </span>
    </>
  )
}

function columnsText(row: AuditRow): string {
  return row.changedColumns.map(auditColumnText).join(", ")
}

/** Codes and columns, never values. */
export function AuditTable({
  caption,
  rows,
}: {
  caption: ReactNode
  rows: AuditRow[]
}) {
  return (
    <Table caption={caption}>
      <thead>
        <tr>
          <Th wide>{m.manage_col_time()}</Th>
          <Th>{m.manage_col_action()}</Th>
          <Th>{m.manage_col_entity()}</Th>
          <Th wide>{m.manage_col_actor()}</Th>
          <Th wide>{m.manage_col_columns()}</Th>
          <Th wide>{m.manage_col_reason()}</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id}>
            <Td wide className="whitespace-nowrap">
              <time dateTime={row.createdAt.toISOString()}>
                {formatDateTime(row.createdAt)}
              </time>
            </Td>
            <Td>
              {actionText(row.action)}
              <PhoneMeta>
                {formatDateTime(row.createdAt)} · <Actor row={row} />
                {row.changedColumns.length > 0
                  ? ` · ${columnsText(row)}`
                  : null}
                {row.reasonCode
                  ? ` · ${auditReasonText(row.reasonCode)}`
                  : null}
              </PhoneMeta>
            </Td>
            <Td className="whitespace-nowrap tabular-nums">
              <Entity row={row} />
            </Td>
            <Td wide>
              <Actor row={row} />
            </Td>
            <Td wide className="font-ui text-sm">
              {columnsText(row)}
            </Td>
            <Td wide className="font-ui text-sm">
              {row.reasonCode ? auditReasonText(row.reasonCode) : ""}
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  )
}
