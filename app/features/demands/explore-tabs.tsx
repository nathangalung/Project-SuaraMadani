import { Link } from "react-router"
import { cn } from "~/components/ui/cn"
import { m } from "~/paraglide/messages.js"

const TABS = [
  { key: "isu", to: "/isu", label: m.explore_tab_issues },
  { key: "tuntutan", to: "/tuntutan", label: m.explore_tab_demands },
] as const

/** /isu and /tuntutan share it. */
export function ExploreTabs({ current }: { current: "isu" | "tuntutan" }) {
  return (
    <nav
      aria-label={m.explore_tabs_label()}
      className="mt-8 flex justify-center"
    >
      <ul className="inline-flex border-2 border-brand">
        {TABS.map((tab) => {
          const active = tab.key === current
          return (
            <li key={tab.key}>
              <Link
                to={tab.to}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "block min-w-32 px-6 py-2.5 text-center font-bold transition-colors duration-(--dur-hover) motion-reduce:transition-none",
                  active
                    ? "bg-brand text-on-accent"
                    : "bg-surface-raised text-accent hover:bg-brand-soft",
                )}
              >
                {tab.label()}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
