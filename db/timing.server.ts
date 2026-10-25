import { AsyncLocalStorage } from "node:async_hooks"
import type { Pool, PoolClient } from "pg"
import { processGlobal } from "./process-global.ts"

// Per-request query time, Server-Timing

export type Timing = { queries: number; dbMs: number }

const current = processGlobal("timing", () => new AsyncLocalStorage<Timing>())

/** Runs work, returns timing. */
export async function timed<T>(work: () => Promise<T>): Promise<[Timing, T]> {
  const timing: Timing = { queries: 0, dbMs: 0 }
  const result = await current.run(timing, work)
  return [timing, result]
}

type Queryable = { query: (...args: never[]) => unknown }

// Promise form only, callbacks nest
function measure<T extends Queryable>(target: T): void {
  const query = target.query
  const wrapped = function (this: T, ...args: unknown[]): unknown {
    const result: unknown = Reflect.apply(query, this, args)
    const timing = current.getStore()
    if (!timing || !(result instanceof Promise)) return result
    timing.queries += 1
    const started = performance.now()
    return result.finally(() => {
      timing.dbMs += performance.now() - started
    })
  }
  target.query = wrapped as T["query"]
}

/** Pool queries and checked-out clients. */
export function instrumentPool(pool: Pool): void {
  measure(pool)
  pool.on("connect", (client: PoolClient) => measure(client))
}

const ms = (value: number) => Math.round(value * 10) / 10

export function timingHeader(timing: Timing, totalMs: number): string {
  return `db;dur=${ms(timing.dbMs)};desc="${timing.queries} queries", total;dur=${ms(totalMs)}`
}
