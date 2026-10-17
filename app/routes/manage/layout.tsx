import { NavLink, Outlet } from "react-router"
import { Container } from "~/components/ui/container"
import { m } from "~/paraglide/messages.js"

// Children inherit these headers
export function headers() {
  return { "Cache-Control": "private, no-store" }
}

// Inactive reads as a link
const NAV =
  "font-semibold text-accent underline underline-offset-4 hover:decoration-2 aria-[current=page]:text-ink aria-[current=page]:decoration-2"

// Current on own page only
const LINKS = [
  { to: "/kelola", label: m.manage_home_title },
  { to: "/kelola/antrean", label: m.manage_queue_title },
  { to: "/kelola/isu", label: m.manage_issues_title },
  { to: "/kelola/tuntutan", label: m.manage_demands_title },
  { to: "/kelola/aduan", label: m.manage_complaints_title },
  { to: "/kelola/audit", label: m.manage_audit_title },
  { to: "/kelola/anggota", label: m.team_title },
  { to: "/kelola/pengaturan", label: m.settings_nav },
] as const

export default function ManageLayout() {
  return (
    <Container width="5xl" className="py-8 pb-16">
      <nav
        aria-label={m.manage_nav_label()}
        className="mb-8 flex flex-wrap items-baseline gap-x-6 gap-y-2 border-line-subtle border-b pb-4"
      >
        <span className="font-bold font-heading text-ink-muted [font-synthesis-weight:none]">
          {m.manage_title()}
        </span>
        {LINKS.map((link) => (
          <NavLink key={link.to} to={link.to} end className={NAV}>
            {link.label()}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </Container>
  )
}
