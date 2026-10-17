import { useSyncExternalStore } from "react"

const subscribe = () => () => {}

/** False in server HTML. */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  )
}
