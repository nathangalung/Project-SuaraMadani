import { useRouteLoaderData } from "react-router"
import { m } from "~/paraglide/messages.js"

/** Tabs stay distinguishable. */
export function siteTitle(title: string, siteName: string | undefined): string {
  return siteName ? `${title} - ${m.og_site_name({ name: siteName })}` : title
}

export function useSiteTitle(title: string): string {
  const root = useRouteLoaderData("root") as { siteName?: unknown } | undefined
  const name = typeof root?.siteName === "string" ? root.siteName : undefined
  return siteTitle(title, name)
}
