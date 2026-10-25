import { AsyncLocalStorage } from "node:async_hooks"
import { processGlobal } from "./process-global.ts"

/** Who and which request. */
export type RequestScope = {
  reqId: string
  userId?: string | null
  // A security line was written
  named?: boolean
}

// SSR bundle shares one store
const storage = processGlobal(
  "requestScope",
  () => new AsyncLocalStorage<RequestScope>(),
)

/** Runs fn inside one scope. */
export function inRequestScope<T>(scope: RequestScope, fn: () => T): T {
  return storage.run(scope, fn)
}

/** Current scope, mutable, or none. */
export function requestScope(): RequestScope | undefined {
  return storage.getStore()
}
