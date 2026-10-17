import { useEffect, useRef } from "react"

/** Swapped content keeps keyboard place. */
export function focusById(
  root: Pick<Document, "getElementById">,
  id: string,
): boolean {
  const target = root.getElementById(id)
  if (!target) return false
  target.focus()
  return true
}

/** Next button, else the input. */
export function focusIdAfterRemoval(
  index: number,
  count: number,
  buttonId: (index: number) => string,
  fallbackId: string,
): string {
  const remaining = count - 1
  if (remaining === 0) return fallbackId
  return buttonId(Math.min(index, remaining - 1))
}

/** Skips mount, runs on change. */
export function useOnChange(key: unknown, effect: () => void): void {
  const last = useRef(key)
  const run = useRef(effect)
  run.current = effect
  useEffect(() => {
    if (Object.is(last.current, key)) return
    last.current = key
    run.current()
  }, [key])
}
