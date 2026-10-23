import type { ReactNode } from "react"

/** Label over value. */
export function Fact({
  term,
  children,
}: {
  term: string
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-ink-muted text-sm">{term}</dt>
      <dd>{children}</dd>
    </div>
  )
}
