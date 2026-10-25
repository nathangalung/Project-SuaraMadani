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
      className="flex w-full gap-1 overflow-x-auto rounded-full bg-surface-raised p-1"
    >
      {tabs.map((tab) => {
        const active = tab.key === current
        return (
          <Link
            key={tab.key}
            to={tab.to}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex-1 whitespace-nowrap rounded-full px-4 py-2 text-center font-semibold transition-colors duration-(--dur-hover) motion-reduce:transition-none",
              active
                ? "bg-brand text-on-accent"
                : "text-ink hover:bg-brand-soft",
            )}
          >
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}
