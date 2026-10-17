import { Link } from "react-router"
import { PhoneMeta, Table, Td, Th } from "~/components/ui/table"
import { m } from "~/paraglide/messages.js"
import { formatDateTime } from "../../../shared/format.ts"
import {
  labelOf,
  REPORT_STATUS_TEXT,
  SUBCATEGORY_TEXT,
} from "../report/public-labels"
import type { QueueRow } from "./queue.server"

function files(row: QueueRow): string {
  return row.files === 0
    ? m.track_no_files()
    : m.manage_files({ ready: row.ready, total: row.files })
}

export function QueueTable({ rows }: { rows: QueueRow[] }) {
  if (rows.length === 0) return <p>{m.manage_queue_empty()}</p>
  return (
    <Table caption={m.manage_queue_caption()}>
      <thead>
        <tr>
          <Th>{m.manage_col_code()}</Th>
          <Th>{m.manage_col_title()}</Th>
          <Th wide>{m.manage_col_received()}</Th>
          <Th wide>{m.manage_col_status()}</Th>
          <Th wide>{m.manage_col_files()}</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.code}>
            <Td className="whitespace-nowrap font-semibold tabular-nums">
              <Link
                to={`/kelola/laporan/${row.code}`}
                className="text-accent underline underline-offset-4"
              >
                {row.code}
              </Link>
            </Td>
            <Td>
              {row.title}
              <span className="block text-ink-muted text-sm">
                {labelOf(SUBCATEGORY_TEXT, row.subcategoryId)}
                {row.forwardedFrom
                  ? ` · ${m.manage_queue_from_campus({ campus: row.forwardedFrom })}`
                  : null}
              </span>
              <PhoneMeta>
                {formatDateTime(row.createdAt)} ·{" "}
                {REPORT_STATUS_TEXT[row.status]()} · {files(row)}
              </PhoneMeta>
            </Td>
            <Td wide className="whitespace-nowrap">
              {formatDateTime(row.createdAt)}
            </Td>
            <Td wide>{REPORT_STATUS_TEXT[row.status]()}</Td>
            <Td wide className="whitespace-nowrap">
              {files(row)}
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  )
}
