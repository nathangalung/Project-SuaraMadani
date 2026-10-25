import {
  ClipboardList,
  History,
  Inbox,
  LayoutGrid,
  type LucideIcon,
  Menu,
  Scale,
  Settings,
  Users,
  X,
} from "lucide-react"
import type { MouseEvent, ReactNode } from "react"
import { Link, NavLink, useRouteLoaderData } from "react-router"
import { brandImages } from "~/components/layout/brand-assets"
import { manageNav } from "~/components/layout/site-nav"
import { ButtonLink } from "~/components/ui/button"
import { cn } from "~/components/ui/cn"
import { m } from "~/paraglide/messages.js"

const SITE_NAME = "Sadar Bersuara"

const ICONS: Record<string, LucideIcon> = {
  "/kelola": LayoutGrid,
  "/kelola/antrean": Inbox,
  "/kelola/isu": ClipboardList,
  "/kelola/tuntutan": Scale,
  "/kelola/audit": History,
  "/kelola/anggota": Users,
  "/kelola/pengaturan": Settings,
}

// Team pages after a divider
const TEAM_FROM = "/kelola/audit"

const ITEM =
  "flex items-center gap-3 rounded-xl px-4 py-2.5 font-semibold text-ink transition-colors duration-(--dur-hover) hover:bg-brand-soft motion-reduce:transition-none aria-[current=page]:bg-brand aria-[current=page]:text-on-accent"

// Root loader fields used here
type RootShell = {
  logoSrc: string | null
  brandAssets: Parameters<typeof brandImages>[0]
  user: { email: string; platform?: boolean } | null
}

function useShellData(): RootShell | undefined {
  return useRouteLoaderData("root") as RootShell | undefined
}

function Brand() {
  const data = useShellData()
  const images = data?.logoSrc
    ? { logoSrc: data.logoSrc, emblemSrc: undefined }
    : brandImages(data?.brandAssets)
  return (
    <Link to="/kelola" className="flex items-center gap-3">
      <img
        src={images.logoSrc}
        alt=""
        width={40}
        height={40}
        className="size-10 shrink-0 object-contain"
      />
      {images.emblemSrc ? (
        <img
          src={images.emblemSrc}
          alt=""
          width={40}
          height={40}
          className="size-10 shrink-0 object-contain max-[359px]:hidden"
        />
      ) : null}
      <span className="flex flex-col leading-tight">
        <span className="whitespace-nowrap font-bold text-lg">{SITE_NAME}</span>
        <span className="text-ink-muted text-sm">{m.manage_title()}</span>
      </span>
    </Link>
  )
}

function NavList({
  onPick,
}: {
  onPick?: (event: MouseEvent<HTMLAnchorElement>) => void
}) {
  const items = manageNav()
  const split = items.findIndex((item) => item.to === TEAM_FROM)
  const groups = [items.slice(0, split), items.slice(split)]
  return (
    <nav aria-label={m.manage_nav_label()}>
      {groups.map((group, index) => (
        <ul
          key={group[0]?.to}
          className={cn(
            "flex flex-col gap-1",
            index > 0 && "mt-4 border-line-subtle border-t pt-4",
          )}
        >
          {group.map((item) => {
            const Icon = ICONS[item.to] ?? LayoutGrid
            return (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.end}
                  onClick={onPick}
                  className={ITEM}
                >
                  <Icon aria-hidden="true" className="size-5 shrink-0" />
                  {item.label}
                </NavLink>
              </li>
            )
          })}
        </ul>
      ))}
    </nav>
  )
}

function Account() {
  const user = useShellData()?.user
  if (!user) return null
  return (
    <div className="flex flex-col gap-3">
      <p className="min-w-0">
        <span className="block text-ink-muted text-sm">
          {m.header_signed_in_label()}
        </span>
        <span className="block truncate font-semibold">{user.email}</span>
      </p>
      {user.platform ? (
        <Link
          to="/admin"
          className="font-semibold text-accent underline underline-offset-4"
        >
          {m.header_platform()}
        </Link>
      ) : null}
      <ButtonLink to="/keluar" variant="secondary" className="w-full">
        {m.header_sign_out()}
      </ButtonLink>
    </div>
  )
}

// Closes the phone menu
function closeMenu(event: MouseEvent<HTMLAnchorElement>) {
  event.currentTarget.closest("details")?.removeAttribute("open")
}

/** Sidebar, phone bar below lg. */
export function ManageShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-svh flex-1 bg-surface">
      {/* Column fills, content sticks */}
      <aside className="hidden w-72 shrink-0 border-line-subtle border-r bg-surface-raised lg:block">
        <div className="sticky top-0 flex h-svh flex-col gap-8 overflow-y-auto px-4 py-7">
          <div className="px-2">
            <Brand />
          </div>
          <NavList />
          <div className="mt-auto border-line-subtle border-t px-2 pt-6">
            <Account />
          </div>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="sticky top-0 z-[1000] flex h-16 items-center justify-between gap-4 border-line-subtle border-b bg-surface-raised px-4 sm:px-6 lg:hidden">
          <Brand />
          <details className="group">
            <summary className="grid size-11 cursor-pointer list-none place-items-center [&::-webkit-details-marker]:hidden">
              <Menu aria-hidden="true" className="size-6 group-open:hidden" />
              <X
                aria-hidden="true"
                className="hidden size-6 group-open:block"
              />
              <span className="sr-only">{m.header_menu()}</span>
            </summary>
            <div className="absolute inset-x-0 top-full flex max-h-[calc(100svh-4rem)] flex-col gap-6 overflow-y-auto border-line-subtle border-b bg-surface-raised px-4 py-5 shadow-floating sm:px-6">
              <NavList onPick={closeMenu} />
              <div className="border-line-subtle border-t pt-5">
                <Account />
              </div>
            </div>
          </details>
        </div>
        <main id="konten" tabIndex={-1} className="flex-1 outline-none">
          <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-8 lg:px-12 lg:py-12">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
