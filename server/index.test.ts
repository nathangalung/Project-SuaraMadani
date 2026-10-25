import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  spyOn,
  test,
} from "bun:test"
import { createDatabase, type Database } from "../db/client.server.ts"
import { migrate } from "../db/migrate.ts"
import { insertOrg, superuserPool, testUrl, until } from "../db/testing.ts"
import { resetAuth } from "./auth.server.ts"
import { type ServerDeps, startServer } from "./index.ts"
import { setErrorReporter } from "./log.ts"

// Auth reads hosts at boot
const HOST = "bootidx.localhost"
const su = superuserPool()

beforeAll(async () => {
  await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
  await su.query("DELETE FROM organizations WHERE slug = 'bootidx'")
  await insertOrg(su, "bootidx")
  resetAuth()
})

afterAll(async () => {
  resetAuth()
  await su.query("DELETE FROM organizations WHERE slug = 'bootidx'")
  await su.end()
})

type Hooks = Map<string, ((error?: unknown) => void)[]>

const quiet = () => [
  spyOn(console, "log").mockImplementation(() => {}),
  spyOn(console, "error").mockImplementation(() => {}),
]

let own: Database | undefined
let restore: { mockRestore: () => void }[] = []

afterEach(async () => {
  for (const spy of restore) spy.mockRestore()
  restore = []
  // Process-wide, never leak
  setErrorReporter(undefined)
  if (own && !own.pool.ended) await own.pool.end()
  own = undefined
})

function boot(env: Record<string, string> = {}) {
  restore = quiet()
  // Own pool, shutdown ends it
  own = createDatabase(testUrl("TEST_DATABASE_URL"), "web")
  const hooks: Hooks = new Map()
  const exits: number[] = []
  const pages: string[] = []
  const database = own
  const deps: ServerDeps = {
    env: { PORT: "0", ...env },
    loadDocument: async () => async (request) => {
      pages.push(new URL(request.url).pathname)
      return new Response("<!doctype html><p>beranda</p>", {
        headers: { "Content-Type": "text/html" },
      })
    },
    database: () => database,
    on: (event, listener) =>
      hooks.set(event, [...(hooks.get(event) ?? []), listener]),
    exit: (code) => exits.push(code),
  }
  return { deps, hooks, exits, pages, database }
}

describe("server/index.ts", () => {
  test("Given Cloudflare test keys on a public apex, when production boots, then it refuses before listening", async () => {
    const { deps } = boot({
      NODE_ENV: "production",
      APEX_HOST: "sadarbersuara.id",
      TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
    })
    await expect(startServer(deps)).rejects.toThrow(
      "TURNSTILE_SITE_KEY is a Cloudflare test key",
    )
  })

  test("Given error reporting misconfigured, when it boots, then it refuses", async () => {
    const { deps } = boot({ ERROR_REPORTING: "true" })
    await expect(startServer(deps)).rejects.toThrow("GLITCHTIP_DSN is not set")
    deps.env.ERROR_REPORTING = "yes"
    await expect(startServer(deps)).rejects.toThrow(
      "ERROR_REPORTING must be true or false",
    )
  })

  test("Given a malformed HSTS policy, when it boots, then it refuses", async () => {
    const { deps } = boot({ HSTS_POLICY: "max-age=forever" })
    await expect(startServer(deps)).rejects.toThrow("HSTS_POLICY invalid")
  })

  test("Given a valid env, when it boots, then health and pages are served on PORT", async () => {
    const { deps, pages } = boot({ GIT_SHA: "abc1234" })
    const { server, shutdown } = await startServer(deps)
    try {
      const base = `http://127.0.0.1:${server.port}`
      const health = await fetch(`${base}/healthz`, {
        headers: { host: HOST },
      })
      expect(health.status).toBe(200)
      expect(await health.json()).toEqual({ status: "ok", sha: "abc1234" })
      const page = await fetch(`${base}/`, {
        headers: { host: HOST },
      })
      expect(page.status).toBe(200)
      expect(await page.text()).toContain("beranda")
      expect(pages).toEqual(["/"])
    } finally {
      await shutdown()
    }
  })

  test("Given a running server, when SIGTERM arrives, then it stops listening, closes the pool and exits 0", async () => {
    const { deps, hooks, exits, database } = boot()
    await database.boss.start()
    const { server } = await startServer(deps)
    const base = `http://127.0.0.1:${server.port}`
    expect([...hooks.keys()].sort()).toEqual([
      "SIGINT",
      "SIGTERM",
      "uncaughtException",
      "unhandledRejection",
    ])
    for (const listener of hooks.get("SIGTERM") ?? []) listener()
    await until(() => exits.length > 0)
    expect(exits).toEqual([0])
    expect(database.pool.ended).toBe(true)
    await expect(fetch(`${base}/healthz`)).rejects.toThrow()
  }, 20_000)

  test("Given a running server, when an error escapes, then it drains and exits 1", async () => {
    const { deps, hooks, exits, database } = boot()
    await database.boss.start()
    const { server } = await startServer(deps)
    const base = `http://127.0.0.1:${server.port}`
    for (const listener of hooks.get("uncaughtException") ?? []) {
      listener(new Error("lepas"))
    }
    await until(() => exits.length > 0)
    expect(exits).toEqual([1])
    expect(database.pool.ended).toBe(true)
    await expect(fetch(`${base}/healthz`)).rejects.toThrow()
  }, 20_000)

  test("Given error reporting on, when an error escapes, then GlitchTip receives it before exit", async () => {
    const received: { auth: string; body: string }[] = []
    const glitchtip = Bun.serve({
      port: 0,
      fetch: async (request) => {
        received.push({
          auth: request.headers.get("x-sentry-auth") ?? "",
          body: await request.text(),
        })
        return new Response("{}")
      },
    })
    try {
      const key = "0123456789abcdef0123456789abcdef"
      const { deps, hooks, exits } = boot({
        ERROR_REPORTING: "true",
        GLITCHTIP_DSN: `http://${key}@127.0.0.1:${glitchtip.port}/7`,
      })
      await startServer(deps)
      for (const listener of hooks.get("uncaughtException") ?? []) {
        listener(new TypeError("lepas"))
      }
      await until(() => exits.length > 0)
      expect(exits).toEqual([1])
      expect(received).toHaveLength(1)
      expect(received[0]?.auth).toContain(`sentry_key=${key}`)
      expect(received[0]?.body).toContain('"type":"TypeError"')
    } finally {
      await glitchtip.stop(true)
    }
  }, 20_000)
})
