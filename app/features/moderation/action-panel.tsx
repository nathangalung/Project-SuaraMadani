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
        "group overflow-hidden rounded-2xl border bg-surface-raised",
        tone === "danger" ? "border-danger" : "border-line-subtle",
      )}
    >
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-6 py-4 font-semibold text-lg transition-colors hover:bg-ink/5 [&::-webkit-details-marker]:hidden">
        {title}
        <ChevronDown
          aria-hidden="true"
          className="size-5 shrink-0 transition-transform group-open:rotate-180"
        />
      </summary>
      <div className="border-line-subtle border-t px-6 pt-6 pb-7">
        {children}
      </div>
    </details>
  )
}
