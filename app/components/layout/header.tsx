import { ChevronDown, Menu, X } from "lucide-react"
import { type MouseEvent, useRef } from "react"
import { Link, NavLink, useLocation } from "react-router"
import { m } from "~/paraglide/messages.js"
import { Button, ButtonLink } from "../ui/button"
import { cn } from "../ui/cn"
import { useDismiss } from "./use-dismiss"

export type NavItem = {
  to: string
  label: string
  // Sections that light this item
  also?: string[]
}

/** NavLink rule plus sibling sections. */
export function isCurrent(item: NavItem, pathname: string): boolean {
  const under = (to: string) =>
    to === "/"
      ? pathname === "/"
      : pathname === to || pathname.startsWith(`${to}/`)
  return [item.to, ...(item.also ?? [])].some(under)
}

type User = { email: string }

type HeaderProps = {
  siteName: string
  tenantName?: string
  nav: NavItem[]
  user: User | null
  logoSrc?: string
  logoSrcSet?: string
  // Active item ornament, tenant set
  navStarSrc?: string
  // Set when a draft exists
  draftHref?: string
  signInHref?: string
  signOutAction?: string
  myReportsHref?: string
  // Caller clears the draft here
  onSignOut?: () => void
  // Page renders its own sign-in
  showSignIn?: boolean
  // Auth pages show logo only
  variant?: "site" | "auth"
}

/** Handle `shell: "auth"`. */
export function isAuthShell(handle: unknown): boolean {
  return (
    typeof handle === "object" &&
    handle !== null &&
    "shell" in handle &&
    handle.shell === "auth"
  )
}

/** Handle flag `pageSignIn`. */
export function hasPageSignIn(handle: unknown): boolean {
  return (
    typeof handle === "object" &&
    handle !== null &&
    "pageSignIn" in handle &&
    handle.pageSignIn === true
  )
}

function closeMenu(event: MouseEvent<HTMLElement>) {
  event.currentTarget.closest("details")?.removeAttribute("open")
}

type Panel = {
  getBoundingClientRect: () => { top: number }
  style: { setProperty: (name: string, value: string) => void }
}

/** Panel fits below its top. */
export function syncMenuTop(panel: Panel | null): void {
  if (!panel) return
  const top = Math.max(0, Math.round(panel.getBoundingClientRect().top))
  panel.style.setProperty("--menu-top", `${top}px`)
}

function Logo({
  siteName,
  tenantName,
  logoSrc,
  logoSrcSet,
}: Pick<HeaderProps, "siteName" | "tenantName" | "logoSrc" | "logoSrcSet">) {
  return (
    <Link to="/" className="flex items-center gap-3 justify-self-start">
      <img
        src={logoSrc}
        alt=""
        width={44}
        height={44}
        srcSet={logoSrcSet}
        className="size-11 shrink-0 object-contain"
      />
      <span className="flex flex-col whitespace-nowrap leading-tight">
        <span className="font-bold text-xl">{siteName}</span>
        {tenantName && <span className="text-xs">{tenantName}</span>}
      </span>
    </Link>
  )
}

function DesktopNav({
  nav,
  navStarSrc,
}: {
  nav: NavItem[]
  navStarSrc?: string
}) {
  const { pathname } = useLocation()
  return (
    <nav
      aria-label={m.header_nav_label()}
      className="hidden justify-self-center xl:block"
    >
      <ul className="flex items-center gap-7">
        {nav.map((item) => {
          const isActive = isCurrent(item, pathname)
          return (
            <li key={item.to}>
              <Link
                to={item.to}
                aria-current={isActive ? "page" : undefined}
                className="group/item relative flex items-center gap-1 whitespace-nowrap py-1 text-lg"
              >
                {isActive && (
                  <span
                    aria-hidden="true"
                    className={cn(
                      "absolute bottom-1 left-0 h-[15px] -rotate-[2.3deg] bg-highlight",
                      navStarSrc ? "right-4" : "right-0",
                    )}
                  />
                )}
                <span
                  className={cn(
                    "relative",
                    isActive
                      ? "font-semibold"
                      : "underline decoration-2 decoration-transparent underline-offset-[6px] transition-[text-decoration-color] duration-(--dur-underline) group-hover/item:decoration-ink",
                  )}
                >
                  {item.label}
                </span>
                {isActive && navStarSrc && (
                  <img
                    src={navStarSrc}
                    alt=""
                    width={11}
                    height={15}
                    loading="lazy"
                    decoding="async"
                    className="pointer-events-none relative -mt-2 w-[11px] max-w-none rotate-[130deg] select-none self-start"
                  />
                )}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

type AccountProps = Pick<
  HeaderProps,
  | "draftHref"
  | "signInHref"
  | "signOutAction"
  | "myReportsHref"
  | "onSignOut"
  | "showSignIn"
> & { user: User | null }

function DraftLink({ href, mobile }: { href: string; mobile?: boolean }) {
  return (
    <Link
      to={href}
      onClick={mobile ? closeMenu : undefined}
      className={cn(
        "whitespace-nowrap font-semibold text-accent underline underline-offset-4",
        mobile && "block py-4 text-lg",
      )}
    >
      {m.header_draft_link()}
    </Link>
  )
}

function SignOutForm({
  action,
  onSignOut,
  mobile,
}: {
  action?: string
  onSignOut?: () => void
  mobile?: boolean
}) {
  return (
    <form method="post" action={action} onSubmit={onSignOut}>
      <Button
        type="submit"
        variant="secondary"
        size={mobile ? "lg" : "md"}
        className="w-full"
      >
        {m.header_sign_out()}
      </Button>
    </form>
  )
}

// Pages left, personal actions right
function DesktopAccount({
  user,
  draftHref,
  signInHref,
  signOutAction,
  myReportsHref,
  onSignOut,
  showSignIn,
}: AccountProps) {
  return (
    <div className="hidden items-center gap-5 justify-self-end xl:flex">
      {draftHref && <DraftLink href={draftHref} />}
      {user ? (
        <details className="group relative">
          <summary
            title={m.header_signed_in_as({ email: user.email })}
            className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-[10px] px-3 hover:bg-ink/5 [&::-webkit-details-marker]:hidden"
          >
            <span className="sr-only">{m.header_account_menu()}: </span>
            <span className="max-w-48 truncate">{user.email}</span>
            <ChevronDown
              aria-hidden="true"
              className="size-5 shrink-0 transition-transform duration-(--dur-hover) group-open:rotate-180"
            />
          </summary>
          <div className="absolute top-full right-0 z-10 mt-2 flex w-60 flex-col gap-2 rounded-[10px] bg-surface-raised p-3 shadow-floating">
            <NavLink
              to={myReportsHref ?? "/lacak"}
              onClick={closeMenu}
              className="block rounded-[10px] px-3 py-2.5 font-semibold underline-offset-4 hover:underline aria-[current=page]:underline"
            >
              {m.nav_track()}
            </NavLink>
            <SignOutForm action={signOutAction} onSignOut={onSignOut} />
          </div>
        </details>
      ) : (
        showSignIn && (
          <ButtonLink to={signInHref ?? "/masuk"} variant="secondary" size="md">
            {m.header_sign_in()}
          </ButtonLink>
        )
      )}
    </div>
  )
}

const ROW = "border-line-subtle border-b"

function MobileMenu({ nav, ...account }: AccountProps & { nav: NavItem[] }) {
  const { pathname } = useLocation()
  const {
    user,
    draftHref,
    signInHref,
    signOutAction,
    myReportsHref,
    showSignIn,
  } = account
  return (
    <details
      className="group xl:hidden"
      onToggle={(event) => {
        const menu = event.currentTarget
        if (menu.open)
          syncMenuTop(menu.querySelector<HTMLElement>("[data-panel]"))
      }}
    >
      <summary className="grid size-11 cursor-pointer list-none place-items-center [&::-webkit-details-marker]:hidden">
        <Menu aria-hidden="true" className="size-6 group-open:hidden" />
        <X aria-hidden="true" className="hidden size-6 group-open:block" />
        <span className="sr-only">{m.header_menu()}</span>
      </summary>
      <div
        data-panel
        className="absolute inset-x-0 top-full max-h-[calc(100svh-var(--menu-top,5rem))] overflow-y-auto bg-surface pb-6 shadow-floating lg:max-h-[calc(100svh-var(--menu-top,6rem))]"
      >
        <nav aria-label={m.header_nav_label()}>
          <ul className="mx-auto flex max-w-7xl flex-col px-6">
            {nav.map((item) => (
              <li key={item.to} className={ROW}>
                <Link
                  to={item.to}
                  aria-current={isCurrent(item, pathname) ? "page" : undefined}
                  onClick={closeMenu}
                  className="block py-4 text-lg aria-[current=page]:font-semibold"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        {(user || draftHref || showSignIn) && (
          <ul className="mx-auto flex max-w-7xl flex-col px-6">
            {draftHref && (
              <li className={ROW}>
                <DraftLink href={draftHref} mobile />
              </li>
            )}
            {user ? (
              <>
                <li className={cn(ROW, "py-4")}>
                  <span className="block text-sm">
                    {m.header_signed_in_label()}
                  </span>
                  <span className="block truncate text-lg">{user.email}</span>
                </li>
                <li className={ROW}>
                  <NavLink
                    to={myReportsHref ?? "/lacak"}
                    onClick={closeMenu}
                    className="block py-4 text-lg aria-[current=page]:font-semibold"
                  >
                    {m.nav_track()}
                  </NavLink>
                </li>
                <li className="pt-5">
                  <SignOutForm
                    action={signOutAction}
                    onSignOut={account.onSignOut}
                    mobile
                  />
                </li>
              </>
            ) : (
              showSignIn && (
                <li className="pt-5">
                  <ButtonLink
                    to={signInHref ?? "/masuk"}
                    onClick={closeMenu}
                    variant="secondary"
                    size="lg"
                    className="w-full"
                  >
                    {m.header_sign_in()}
                  </ButtonLink>
                </li>
              )
            )}
          </ul>
        )}
      </div>
    </details>
  )
}

export function Header({
  siteName,
  tenantName,
  nav,
  user,
  logoSrc = "/logo.svg",
  logoSrcSet,
  navStarSrc,
  draftHref,
  signInHref = "/masuk",
  signOutAction = "/keluar",
  myReportsHref = "/lacak",
  onSignOut,
  showSignIn = true,
  variant = "site",
}: HeaderProps) {
  const ref = useRef<HTMLElement>(null)
  useDismiss(ref)
  const logo = { siteName, tenantName, logoSrc, logoSrcSet }
  if (variant === "auth") {
    return (
      <header className="header-bg text-ink">
        <div className="mx-auto flex h-20 max-w-7xl items-center px-4 sm:px-8">
          <Logo {...logo} />
        </div>
      </header>
    )
  }
  const account = {
    user,
    draftHref,
    signInHref,
    signOutAction,
    myReportsHref,
    onSignOut,
    showSignIn,
  }
  return (
    <header
      ref={ref}
      className="header-bg sticky top-0 z-[1000] text-ink [@media(max-height:30rem)]:static"
    >
      <div className="relative mx-auto flex h-20 max-w-7xl items-center justify-between gap-4 px-4 sm:px-8 lg:h-24 xl:grid xl:grid-cols-[1fr_auto_1fr] xl:gap-8">
        <Logo {...logo} />
        <DesktopNav nav={nav} navStarSrc={navStarSrc} />
        <DesktopAccount {...account} />
        <MobileMenu nav={nav} {...account} />
      </div>
    </header>
  )
}
