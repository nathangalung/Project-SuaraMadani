import type {
  ReactNode,
  TableHTMLAttributes,
  TdHTMLAttributes,
  ThHTMLAttributes,
} from "react"
import { useId } from "react"
import { cn } from "./cn"

type TableProps = TableHTMLAttributes<HTMLTableElement> & {
  caption: ReactNode
  // Visible heading names it
  captionHidden?: boolean
  children: ReactNode
}

// Scrollable region stays keyboard reachable
export function Table({
  caption,
  captionHidden,
  className,
  children,
  ...rest
}: TableProps) {
  const captionId = useId()
  return (
    <section
      aria-labelledby={captionId}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: keyboard scroll on narrow screens
      tabIndex={0}
      className="max-w-full overflow-x-auto"
    >
      <table
        className={cn(
          // Ruled grid, rounded frame
          "w-full border-separate border-spacing-0 rounded-2xl border border-line-subtle bg-surface-raised text-left",
          // Corner cells follow the frame
          "[&_thead_tr:first-child>:first-child]:rounded-tl-2xl [&_thead_tr:first-child>:last-child]:rounded-tr-2xl [&_tbody_tr:last-child>:first-child]:rounded-bl-2xl [&_tbody_tr:last-child>:last-child]:rounded-br-2xl",
          "[&_tbody_tr:last-child>*]:border-b-0 [&_tbody_tr:nth-child(even)>*]:bg-surface [&_tbody_tr:hover>*]:bg-brand-soft",
          className,
        )}
        {...rest}
      >
        <caption
          id={captionId}
          className={cn(
            "mb-3 text-left font-bold text-lg",
            captionHidden && "sr-only",
          )}
        >
          {caption}
        </caption>
        {children}
      </table>
    </section>
  )
}

// wide: hidden on phones
type CellProps = { numeric?: boolean; wide?: boolean }

export function Th({
  numeric,
  wide,
  scope = "col",
  className,
  ...rest
}: ThHTMLAttributes<HTMLTableCellElement> & CellProps) {
  return (
    <th
      scope={scope}
      className={cn(
        "whitespace-nowrap border-line-subtle border-r border-b bg-brand-soft px-4 py-3 font-semibold last:border-r-0",
        numeric && "text-right tabular-nums",
        wide && "max-sm:hidden",
        className,
      )}
      {...rest}
    />
  )
}

export function Td({
  numeric,
  wide,
  className,
  ...rest
}: TdHTMLAttributes<HTMLTableCellElement> & CellProps) {
  return (
    <td
      className={cn(
        "border-line-subtle border-r border-b px-4 py-3 transition-colors last:border-r-0",
        // Ranges like 1–4 stay whole
        numeric && "whitespace-nowrap text-right tabular-nums",
        wide && "max-sm:hidden",
        className,
      )}
      {...rest}
    />
  )
}

/** Wide cells, repeated on phones. */
export function PhoneMeta({ children }: { children: ReactNode }) {
  return (
    <span className="mt-1 block text-ink-muted text-sm sm:hidden">
      {children}
    </span>
  )
}
