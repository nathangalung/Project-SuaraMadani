import { ShieldCheck } from "lucide-react"
import { NavLink, Outlet } from "react-router"
import { Container } from "~/components/ui/container"
import { m } from "~/paraglide/messages.js"

// Children inherit these headers
export function headers() {
  return { "Cache-Control": "private, no-store" }
}

export default function AdminLayout() {
  return (
    <Container width="5xl" className="py-8 pb-16">
      <div className="mb-8 flex flex-wrap items-center gap-x-3 gap-y-2 border-line-subtle border-b pb-4">
        <span
          aria-hidden="true"
          className="grid size-8 place-items-center bg-ink text-surface-raised"
        >
          <ShieldCheck className="size-4" />
        </span>
        <span className="font-bold font-heading text-ink-muted [font-synthesis-weight:none]">
          {m.admin_title()}
        </span>
        <span className="font-ui text-ink-muted text-sm">
          {m.admin_scope()}
        </span>
        <nav
          aria-label={m.admin_nav_label()}
          className="flex w-full flex-wrap gap-x-6 gap-y-2 pt-2"
        >
          {[
            { to: "/admin", label: m.admin_campuses_title(), end: true },
            {
              to: "/admin/whatsapp",
              label: m.admin_nav_whatsapp(),
              end: false,
            },
          ].map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className="font-semibold text-accent underline underline-offset-4 hover:decoration-2 aria-[current=page]:text-ink aria-[current=page]:decoration-2"
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </div>
      <Outlet />
    </Container>
  )
}
