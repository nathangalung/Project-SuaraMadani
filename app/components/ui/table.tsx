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
        className={cn("w-full border-collapse text-left", className)}
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
        "border-line border-b-2 px-3 py-2 font-semibold",
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
        "border-line-subtle border-b px-3 py-2",
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
    <span className="mt-1 block font-ui text-ink-muted text-sm sm:hidden">
      {children}
    </span>
  )
}
