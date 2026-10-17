import { ChevronDown } from "lucide-react"
import type { ReactNode } from "react"
import { cn } from "~/components/ui/cn"

/** Native disclosure, works without JS. */
export function ActionPanel({
  id,
  title,
  open = false,
  tone = "default",
  children,
}: {
  id: string
  title: string
  open?: boolean
  // Danger only for irreversible actions
  tone?: "default" | "danger"
  children: ReactNode
}) {
  return (
    <details
      id={id}
      open={open}
      className={cn(
        "group border bg-surface-raised",
        tone === "danger" ? "border-danger" : "border-line-subtle",
      )}
    >
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 font-semibold transition-colors hover:bg-ink/5 [&::-webkit-details-marker]:hidden">
        {title}
        <ChevronDown
          aria-hidden="true"
          className="size-5 shrink-0 transition-transform group-open:rotate-180"
        />
      </summary>
      <div className="border-line-subtle border-t px-5 pt-5 pb-6">
        {children}
      </div>
    </details>
  )
}
