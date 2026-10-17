import { Link } from "react-router"
import { cn } from "~/components/ui/cn"

export type FilterTab = { key: string; label: string; to: string }

// URL tabs, no client JS
export function FilterTabs({
  label,
  tabs,
  current,
}: {
  label: string
  tabs: FilterTab[]
  current: string
}) {
  return (
    <nav
      aria-label={label}
      className="flex flex-wrap border-ink border-b-2 bg-surface"
    >
      {tabs.map((tab) => {
        const active = tab.key === current
        return (
          <Link
            key={tab.key}
            to={tab.to}
            aria-current={active ? "page" : undefined}
            className={cn(
              "min-h-11 px-4 py-2.5 font-semibold text-sm transition-colors",
              active
                ? "bg-brand text-on-accent"
                : "text-ink underline-offset-4 hover:bg-ink/5 hover:underline",
            )}
          >
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}
