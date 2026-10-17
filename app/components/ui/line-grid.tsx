import type { ReactNode } from "react"
import { cn } from "./cn"

type Item = { title: string; body: ReactNode }

const columns = {
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-2 lg:grid-cols-3",
  4: "sm:grid-cols-2 lg:grid-cols-4",
} as const

// Hairlines instead of boxes
export function LineGrid({
  items,
  columnCount = 4,
  numbered = true,
  titleAs: Title = "h3",
  className,
}: {
  items: readonly Item[]
  columnCount?: keyof typeof columns
  numbered?: boolean
  // Follows the page outline
  titleAs?: "h3" | "h4"
  className?: string
}) {
  const List = numbered ? "ol" : "ul"
  return (
    <List
      className={cn(
        "mx-auto grid max-w-6xl border-ink border-t-2",
        columns[columnCount],
        className,
      )}
    >
      {items.map((item, index) => (
        <li key={item.title} className="border-ink/15 border-b py-6 sm:pr-8">
          {numbered && (
            <span
              aria-hidden="true"
              className="block font-semibold font-ui text-accent text-sm tabular-nums"
            >
              {String(index + 1).padStart(2, "0")}
            </span>
          )}
          <Title className="mt-2 font-bold text-lg leading-snug">
            {item.title}
          </Title>
          <p className="mt-2 font-ui text-[0.95rem] text-ink-soft leading-relaxed">
            {item.body}
          </p>
        </li>
      ))}
    </List>
  )
}
