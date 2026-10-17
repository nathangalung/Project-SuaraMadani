import { Table2 } from "lucide-react"
import { type ReactNode, useState } from "react"
import { Card } from "~/components/ui/card"
import { cn } from "~/components/ui/cn"
import { Table, Td, Th } from "~/components/ui/table"
import { m } from "~/paraglide/messages.js"
import { formatDate } from "../../../shared/format.ts"
import {
  type DashboardChart,
  METHOD_CHANGES,
  type MethodChange,
} from "./method-changes"

type ChartCardProps = {
  title: string
  description?: ReactNode
  // Table twin, PLAN §5.8
  table: ReactNode
  legend?: ReactNode
  meta: ReactNode
  // Marked when its method changed
  chart?: DashboardChart
  changes?: readonly MethodChange[]
  className?: string
  children: ReactNode
}

// Mockup ChartCard, table toggle
export function ChartCard({
  title,
  description,
  table,
  legend,
  meta,
  chart,
  changes = METHOD_CHANGES,
  className,
  children,
}: ChartCardProps) {
  const [showTable, setShowTable] = useState(false)
  const changed = chart
    ? changes.find((change) => change.charts.includes(chart))
    : undefined
  return (
    <Card className={cn("flex flex-col p-5 sm:p-6", className)}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-bold text-xl">{title}</h3>
          {description && (
            <p className="mt-0.5 font-ui text-ink-muted text-sm">
              {description}
            </p>
          )}
        </div>
        {/* Needs JS, bars stay readable */}
        <button
          type="button"
          onClick={() => setShowTable((value) => !value)}
          aria-pressed={showTable}
          className="flex shrink-0 items-center gap-1.5 border-2 border-ink px-3 py-1.5 font-semibold font-ui text-ink text-xs transition-colors hover:bg-surface aria-pressed:bg-ink aria-pressed:text-surface-raised noscript:hidden"
        >
          {/* Fixed label, pressed state speaks */}
          <Table2 aria-hidden="true" className="size-3.5" />
          {m.data_show_table()}
          {/* WCAG 2.4.6: which chart */}
          <span className="sr-only">{` ${title}`}</span>
        </button>
      </div>
      {legend && !showTable && <div className="mt-4">{legend}</div>}
      <div className="mt-4 flex-1">
        {showTable ? (
          table
        ) : (
          <>
            <div className="h-full noscript:hidden">{children}</div>
            {/* No-JS readers get the table */}
            <div className="hidden noscript:block">{table}</div>
          </>
        )}
      </div>
      <p className="mt-4 border-line-subtle border-t pt-3 font-ui text-ink-muted text-xs">
        {meta}
        {changed ? (
          <>
            {" · "}
            <a
              href="#metode"
              className="font-semibold text-ink underline underline-offset-2"
            >
              {m.data_method_changed({
                date: formatDate(new Date(changed.on)),
              })}
            </a>
          </>
        ) : null}
      </p>
    </Card>
  )
}

type Cell = string | number

// First column heads the row
export function DataTable({
  caption,
  captionHidden,
  columns,
  rows,
}: {
  caption: string
  captionHidden?: boolean
  columns: string[]
  rows: Cell[][]
}) {
  return (
    <Table
      caption={caption}
      captionHidden={captionHidden}
      className="font-ui text-sm"
    >
      <thead>
        <tr>
          {columns.map((column, i) => (
            <Th key={column} numeric={i > 0}>
              {column}
            </Th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={String(row[0])}>
            {row.map((cell, i) =>
              i === 0 ? (
                <th
                  key={columns[i]}
                  scope="row"
                  className="border-line-subtle border-b px-3 py-2 text-left font-semibold"
                >
                  {cell}
                </th>
              ) : (
                <Td key={columns[i]} numeric>
                  {cell}
                </Td>
              ),
            )}
          </tr>
        ))}
      </tbody>
    </Table>
  )
}
