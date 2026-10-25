import { NavLink, Outlet } from "react-router"
import { manageNav } from "~/components/layout/site-nav"
import { Container } from "~/components/ui/container"
import { m } from "~/paraglide/messages.js"

// Children inherit these headers
export function headers() {
  return { "Cache-Control": "private, no-store" }
}

// Pill strip, scrolls on phones
const NAV =
  "block whitespace-nowrap rounded-full px-4 py-2 font-semibold text-ink transition-colors duration-(--dur-hover) hover:bg-brand-soft motion-reduce:transition-none aria-[current=page]:bg-brand aria-[current=page]:text-on-accent"

export default function ManageLayout() {
  return (
    <Container width="6xl" className="py-8 pb-16">
      <nav aria-label={m.manage_nav_label()} className="mb-10">
        <p className="mb-3 font-heading text-ink-muted text-lg">
          {m.manage_title()}
        </p>
        <ul className="flex w-fit max-w-full gap-1 overflow-x-auto rounded-full bg-surface-raised p-1">
          {/* Section stays current on detail */}
          {manageNav().map((link) => (
            <li key={link.to}>
              <NavLink to={link.to} end={link.end} className={NAV}>
                {link.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <Outlet />
    </Container>
  )
}
