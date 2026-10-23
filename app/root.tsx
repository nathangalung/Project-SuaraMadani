import { lazy, type ReactNode, Suspense, useEffect, useState } from "react"
import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLocation,
  useMatches,
  useRouteError,
  useRouteLoaderData,
} from "react-router"
import { brandImages } from "~/components/layout/brand-assets"
import { Footer } from "~/components/layout/footer"
import { Header, hasPageSignIn, isAuthShell } from "~/components/layout/header"
import { IntakeBanner } from "~/components/layout/intake-banner"
import { useRouteFocus } from "~/components/layout/route-focus"
import { ownsDescription, SiteMeta } from "~/components/layout/site-meta"
import {
  footerNav,
  mainNav,
  nationalNav,
  policyNav,
} from "~/components/layout/site-nav"
import { SkipLink } from "~/components/layout/skip-link"
import {
  browserStorage,
  clearDraft,
  resumeHref,
} from "~/features/report/draft-store"
import { siteTitle } from "~/features/report/page-title"
import { m } from "~/paraglide/messages.js"
import { rootMiddleware } from "../server/request-context.server.ts"
import {
  type ForbiddenData,
  nationalShellData,
  type ShellData,
  shellData,
} from "../server/shell.server.ts"
import type { WebFont } from "../server/theme.server.ts"
import type { Route } from "./+types/root"
import { nationalContext, sessionContext, tenantContext } from "./context.ts"
import aleoUrl from "./fonts/aleo-latin-400.woff2?url"
import barlowUrl from "./fonts/barlow-latin-400.woff2?url"
import tiltWarpUrl from "./fonts/tilt-warp-latin-400.woff2?url"
import "~/styles.css"

// Hashed URLs, headings use 400
const HEADING_FONT_URL: Record<WebFont, string> = {
  "tilt-warp": tiltWarpUrl,
  aleo: aleoUrl,
  barlow: barlowUrl,
}

const SITE_NAME = "Sadar Bersuara"

// Error markup not first-load
const RootError = lazy(() =>
  import("~/components/layout/error-page").then((module) => ({
    default: module.RootError,
  })),
)

export const middleware: Route.MiddlewareFunction[] = [rootMiddleware]

export function loader({ context }: Route.LoaderArgs): ShellData {
  if (context.get(nationalContext)) return nationalShellData()
  return shellData(context.get(tenantContext), context.get(sessionContext))
}

// Middleware 403 and apex 404
function forbiddenOf(error: unknown): ForbiddenData | undefined {
  if (!isRouteErrorResponse(error)) return undefined
  if (error.status !== 403 && error.status !== 404) return undefined
  const body: unknown = error.data
  return body && typeof body === "object" && "shell" in body
    ? (body as ForbiddenData)
    : undefined
}

// Root data or 403 shell
function useShell(): ShellData | undefined {
  const data = useRouteLoaderData<typeof loader>("root")
  const error = useRouteError()
  return data ?? forbiddenOf(error)?.shell
}

// sessionStorage exists after hydration
function useDraftHref(): string | undefined {
  const { pathname } = useLocation()
  const [href, setHref] = useState<string>()
  useEffect(() => {
    setHref(
      pathname.startsWith("/lapor") ? undefined : resumeHref(browserStorage()),
    )
  }, [pathname])
  return href
}

export function Layout({ children }: { children: ReactNode }) {
  const data = useShell()
  const draftHref = useDraftHref()
  const matches = useMatches()
  const pageDescribed = matches.some((match) => ownsDescription(match.handle))
  const authShell = matches.some((match) => isAuthShell(match.handle))
  const pageSignIn = matches.some((match) => hasPageSignIn(match.handle))
  const { pathname } = useLocation()
  const brand = data?.logoSrc
    ? {
        ...brandImages(data.brandAssets),
        logoSrc: data.logoSrc,
        logoSrcSet: undefined,
        // Custom logo, no extras
        logoIntroSrc: undefined,
        logoIntroSrcSet: undefined,
        emblemSrc: undefined,
        emblemSrcSet: undefined,
      }
    : brandImages(data?.brandAssets)
  // Report steps have their own
  const stepPage =
    pathname === "/lapor" ||
    (pathname.startsWith("/lapor/") && !pathname.startsWith("/lapor/sukses/"))
  const showPause = data?.intakePaused === true && !stepPage
  // Apex: tables only, no JS
  const national = data?.national === true
  useRouteFocus()
  return (
    <html lang="id">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        {data ? (
          <SiteMeta
            siteName={data.siteName}
            description={national ? m.national_description() : undefined}
            themeColor={data.themeColor}
            withDescription={!pageDescribed}
            headingFontUrl={
              data.headingFont ? HEADING_FONT_URL[data.headingFont] : undefined
            }
          />
        ) : null}
        {data?.themeCss ? (
          // Only themeStyle output reaches here
          // biome-ignore lint/security/noDangerouslySetInnerHtml: validated token allowlist
          <style dangerouslySetInnerHTML={{ __html: data.themeCss }} />
        ) : null}
        <Meta />
        <Links />
      </head>
      <body>
        <SkipLink />
        {/* Footer stays at the bottom */}
        <div className="flex min-h-svh flex-col">
          <Header
            siteName={SITE_NAME}
            nav={national ? nationalNav() : mainNav()}
            user={data?.user ?? null}
            {...brand}
            draftHref={national ? undefined : draftHref}
            onSignOut={() => clearDraft(browserStorage())}
            showSignIn={!pageSignIn && !national}
            variant={authShell ? "auth" : "site"}
          />
          {showPause ? (
            <IntakeBanner statusHref={data?.identity.statusHref} />
          ) : null}
          {/* Auth pages centre one card */}
          <main
            id="konten"
            tabIndex={-1}
            className={`flex-1 outline-none ${authShell ? "flex flex-col" : ""}`}
          >
            {children}
          </main>
          {data ? (
            <Footer
              siteName={SITE_NAME}
              {...data.identity}
              note={national ? m.national_footer_note() : undefined}
              links={national ? nationalNav().slice(1) : footerNav()}
              policyLinks={policyNav()}
              logoSrc={brand.logoSrc}
              logoSrcSet={brand.logoSrcSet}
              emblemSrc={brand.emblemSrc}
              emblemSrcSet={brand.emblemSrcSet}
              year={data.year}
            />
          ) : null}
        </div>
        {national ? null : (
          <>
            <ScrollRestoration />
            <Scripts />
          </>
        )}
      </body>
    </html>
  )
}

export default function App() {
  return <Outlet />
}

// Never prints statusText or stack
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const shell = useShell()
  return (
    <Suspense>
      <RootError
        status={isRouteErrorResponse(error) ? error.status : 500}
        signedIn={Boolean(shell?.user)}
        staff={forbiddenOf(error)?.staff === true}
        national={shell?.national === true}
        titleOf={(title) => siteTitle(title, shell?.siteName)}
      />
    </Suspense>
  )
}
