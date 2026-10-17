import { type RefObject, useEffect, useRef } from "react"
import { useLocation } from "react-router"
import { routeKey } from "./route-focus"

/** Closes open menus inside root. */
export function closeOutside(root: ParentNode, target: Node | null): void {
  for (const menu of root.querySelectorAll("details[open]")) {
    if (!target || !menu.contains(target)) menu.removeAttribute("open")
  }
}

/** Outside press, focus or Escape. */
export function bindDismiss(
  doc: Pick<Document, "addEventListener" | "removeEventListener">,
  root: () => ParentNode | null,
): () => void {
  const onOutside = (event: Event) => {
    const menus = root()
    if (menus) closeOutside(menus, event.target as Node)
  }
  const onKey = (event: KeyboardEvent) => {
    const menu = root()?.querySelector("details[open]")
    if (event.key !== "Escape" || !menu) return
    menu.removeAttribute("open")
    menu.querySelector("summary")?.focus()
  }
  doc.addEventListener("pointerdown", onOutside)
  doc.addEventListener("focusin", onOutside)
  doc.addEventListener("keydown", onKey)
  return () => {
    doc.removeEventListener("pointerdown", onOutside)
    doc.removeEventListener("focusin", onOutside)
    doc.removeEventListener("keydown", onKey)
  }
}

export function useDismiss(ref: RefObject<HTMLElement | null>): void {
  const key = routeKey(useLocation())
  const last = useRef(key)
  useEffect(() => bindDismiss(document, () => ref.current), [ref])
  // Navigation closes open menus
  useEffect(() => {
    if (last.current === key) return
    last.current = key
    if (ref.current) closeOutside(ref.current, null)
  }, [key, ref])
}
