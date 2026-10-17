import { useEffect } from "react"
import { useLocation, useMatches } from "react-router"

type At = { pathname: string; search: string }

/** Hash changes are not navigations. */
export function routeKey(location: At) {
  return `${location.pathname}${location.search}`
}

/** Handle flag `keepFocusOnQuery`. */
export function keepsFocusOnQuery(handle: unknown): boolean {
  return (
    typeof handle === "object" &&
    handle !== null &&
    "keepFocusOnQuery" in handle &&
    handle.keepFocusOnQuery === true
  )
}

const NATIVE_FOCUS = "a[href],button,input,select,textarea,[tabindex]"

/** Plain id from URL hash. */
function hashId(hash: string): string | undefined {
  try {
    const id = decodeURIComponent(hash.replace(/^#/, ""))
    return /^[A-Za-z][\w-]*$/.test(id) ? id : undefined
  } catch {
    return undefined
  }
}

/** Hash target, else page h1. */
export function focusPageHeading(root: ParentNode, hash = ""): boolean {
  const id = hashId(hash)
  const linked = id
    ? root.querySelector<HTMLElement>(`main [id="${id}"]`)
    : null
  const target =
    linked ??
    root.querySelector<HTMLElement>("main h1") ??
    root.querySelector<HTMLElement>("main")
  if (!target) return false
  // Controls stay in tab order
  const focusable = linked
    ? linked.matches(NATIVE_FOCUS)
    : target.hasAttribute("tabindex")
  if (!focusable) target.setAttribute("tabindex", "-1")
  target.focus({ preventScroll: true })
  return true
}

/** True when focus should move. */
export function routeFocusGate() {
  let last: At | undefined
  return (at: At, keepOnQuery: boolean): boolean => {
    const previous = last
    last = at
    // Initial load keeps browser focus
    if (!previous) return false
    if (previous.pathname !== at.pathname) return true
    return previous.search !== at.search && !keepOnQuery
  }
}

// Outlives error boundary remounts
const moves = routeFocusGate()

/** Client navigations move focus. */
export function useRouteFocus(): void {
  const { pathname, search, hash } = useLocation()
  const keepOnQuery = keepsFocusOnQuery(useMatches().at(-1)?.handle)
  useEffect(() => {
    if (moves({ pathname, search }, keepOnQuery)) {
      focusPageHeading(document, hash)
    }
  }, [pathname, search, hash, keepOnQuery])
}
