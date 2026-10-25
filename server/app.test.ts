import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DrizzleQueryError } from "drizzle-orm/errors"
import { Hono } from "hono"
import { HTTPException } from "hono/http-exception"
import { m } from "../app/paraglide/messages.js"
import { requestScope } from "../db/request-scope.ts"
import messages from "../messages/id.json"
import { EVIDENCE_LIMITS } from "../shared/report-fields.ts"
import {
  type AppOptions,
  createApp,
  MAX_BRIEF_BODY,
  MAX_FORM_BODY,
  SERVE_LIMITS,
} from "./app"
import { securityRecord } from "./log.ts"
import { loadShed } from "./middleware/load-shed.ts"

type Seen = { url: string }

function appWith(overrides: Partial<AppOptions> = {}) {
  const seen: Seen[] = []
  const lines: Record<string, unknown>[] = []
  const app = createApp({
    handleDocument: async (request) => {
      seen.push({ url: request.url })
      return new Response("document", {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      })
    },
    health: {
      db: async () => {},
      jobs: async () => ({ ok: true, checks: {} }),
    },
    log: (line) => lines.push(line),
    ...overrides,
  })
  return { app, seen, lines }
}

const host = "http://itb.localhost"

describe("health", () => {
  test("healthz answers ok and the image sha without React Router", async () => {
    const { app, seen } = appWith({ sha: "0123abc" })
    const res = await app.request(`${host}/healthz`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: "ok", sha: "0123abc" })
    expect(res.headers.get("Cache-Control")).toBe("no-store")
    expect(seen).toEqual([])
  })

  test("healthz is 503 when the database check fails", async () => {
    const { app } = appWith({
      health: {
        db: async () => {
          throw new Error("down")
        },
        jobs: async () => ({ ok: true, checks: {} }),
      },
    })
    const res = await app.request(`${host}/healthz`)
    expect(res.status).toBe(503)
    expect(await res.text()).not.toContain("down")
    expect(res.headers.get("Cache-Control")).toBe("no-store")
  })

  test("healthz names a dev build", async () => {
    const { app } = appWith()
    const res = await app.request(`${host}/healthz`)
    expect(await res.json()).toEqual({ status: "ok", sha: "dev" })
  })

  test("healthz/jobs shows checks to the token only", async () => {
    // API8: operational state stays private
    const token = "t".repeat(32)
    const { app } = appWith({
      health: {
        db: async () => {},
        jobs: async () => ({ ok: false, checks: { "evidence-dlq": 2 } }),
      },
      healthToken: token,
    })
    const read = (authorization?: string) =>
      app.request(`${host}/healthz/jobs`, {
        headers: authorization ? { authorization } : {},
      })
    for (const header of [undefined, "Bearer wrong", `Basic ${token}`]) {
      const res = await read(header)
      expect(res.status).toBe(503)
      expect(await res.json()).toEqual({ ok: false })
      expect(res.headers.get("Cache-Control")).toBe("no-store")
    }
    const res = await read(`Bearer ${token}`)
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({
      ok: false,
      checks: { "evidence-dlq": 2 },
    })
  })

  test("Given the jobs check itself fails, then healthz/jobs is 503 and leaks nothing", async () => {
    const token = "t".repeat(32)
    const { app } = appWith({
      health: {
        db: async () => {},
        jobs: async () => {
          throw new Error("pool exhausted")
        },
      },
      healthToken: token,
    })
    const res = await app.request(`${host}/healthz/jobs`, {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ ok: false })
    expect(res.headers.get("Cache-Control")).toBe("no-store")
  })

  test("healthz/jobs without a token never shows checks", async () => {
    const { app } = appWith({
      health: {
        db: async () => {},
        jobs: async () => ({ ok: true, checks: { "evidence-dlq": 0 } }),
      },
    })
    const res = await app.request(`${host}/healthz/jobs`, {
      headers: { authorization: "Bearer " },
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })
})

describe("static files", () => {
  // architecture.md: hashed assets 1 year
  test("Given a client build, when an asset and a public file are fetched, then each carries its cache policy without React Router", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sb-client-"))
    mkdirSync(join(dir, "assets"))
    writeFileSync(join(dir, "assets", "entry-a1b2c3.js"), "export {}")
    writeFileSync(join(dir, "robots.txt"), "User-agent: *")
    try {
      const { app, seen } = appWith({ clientDir: dir })
      const asset = await app.request(`${host}/assets/entry-a1b2c3.js`)
      expect(asset.status).toBe(200)
      expect(await asset.text()).toBe("export {}")
      expect(asset.headers.get("Cache-Control")).toBe(
        "public, max-age=31536000, immutable",
      )
      const robots = await app.request(`${host}/robots.txt`)
      expect(robots.status).toBe(200)
      expect(await robots.text()).toBe("User-agent: *")
      expect(robots.headers.get("Cache-Control")).toBe("public, max-age=3600")
      expect(seen).toEqual([])
      await app.request(`${host}/isu`)
      expect(seen.map((one) => new URL(one.url).pathname)).toEqual(["/isu"])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("auth limiter", () => {
  test("a Better Auth 429 also sends Retry-After", async () => {
    // API4: RFC 9110 header
    const { app } = appWith({
      handleDocument: async () =>
        new Response(null, {
          status: 429,
          headers: { "X-Retry-After": "60" },
        }),
    })
    const res = await app.request(`${host}/api/auth/account/lookup`, {
      method: "POST",
      headers: { origin: host },
    })
    expect(res.status).toBe(429)
    expect(res.headers.get("Retry-After")).toBe("60")
  })
})

describe("document handler", () => {
  test("other paths reach React Router", async () => {
    const { app, seen } = appWith()
    const res = await app.request(`${host}/isu/ISU-ITB-26-0042`)
    expect(await res.text()).toBe("document")
    expect(seen).toEqual([{ url: `${host}/isu/ISU-ITB-26-0042` }])
  })

  test("the public URL scheme comes from the proxy header", async () => {
    const { app, seen } = appWith()
    await app.request(`${host}/isu`, {
      headers: { "x-forwarded-proto": "https" },
    })
    expect(seen[0]?.url).toBe("https://itb.localhost/isu")
  })

  test("a streamed upload body survives the https rewrite", async () => {
    const bodies: string[] = []
    const { app } = appWith({
      handleDocument: async (request) => {
        bodies.push(`${request.url} ${await request.text()}`)
        return new Response("ok")
      },
    })
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("part-1,"))
        controller.enqueue(new TextEncoder().encode("part-2"))
        controller.close()
      },
    })
    await app.request(`${host}/api/upload/abc`, {
      method: "POST",
      body,
      duplex: "half",
      headers: { "x-forwarded-proto": "https" },
    } as RequestInit)
    expect(bodies).toEqual([
      "https://itb.localhost/api/upload/abc part-1,part-2",
    ])
  })

  test("API paths also reach React Router", async () => {
    const { app, seen } = appWith()
    await app.request(`${host}/api/auth/get-session`)
    await app.request(`${host}/api/upload/0199`, { method: "POST" })
    expect(seen.map((s) => new URL(s.url).pathname)).toEqual([
      "/api/auth/get-session",
      "/api/upload/0199",
    ])
  })
})

describe("cache headers", () => {
  test("anonymous 200 gets the public pair", async () => {
    const { app } = appWith()
    const res = await app.request(`${host}/isu`)
    expect(res.headers.get("Cache-Control")).toBe(
      "public, max-age=0, no-transform",
    )
    expect(res.headers.get("Cloudflare-CDN-Cache-Control")).toBe(
      "max-age=60, stale-while-revalidate=30, stale-if-error=86400",
    )
  })

  test("a session cookie makes it private", async () => {
    const { app } = appWith()
    const res = await app.request(`${host}/isu`, {
      headers: { cookie: "sb.session_token=abc" },
    })
    expect(res.headers.get("Cache-Control")).toBe("private, no-store")
    expect(res.headers.has("Cloudflare-CDN-Cache-Control")).toBe(false)
  })

  test("errors are no-store", async () => {
    const { app } = appWith({
      handleDocument: async () => new Response("nope", { status: 404 }),
    })
    const res = await app.request(`${host}/isu/missing`)
    expect(res.headers.get("Cache-Control")).toBe("no-store")
  })

  test("report form is private", async () => {
    const { app } = appWith()
    const res = await app.request(`${host}/lapor`)
    expect(res.headers.get("Cache-Control")).toBe("private, no-store")
  })
})

describe("compression", () => {
  const page = `<!doctype html>${"<p>Isu publik</p>".repeat(6000)}`
  const gzip = { "Accept-Encoding": "gzip, deflate, br, zstd" }

  function serving(body: string | null, type: string, status = 200) {
    return appWith({
      handleDocument: async () =>
        new Response(body, { status, headers: { "Content-Type": type } }),
    }).app
  }

  test("public HTML is gzipped at the origin", async () => {
    const app = serving(page, "text/html; charset=utf-8")
    const res = await app.request(`${host}/isu`, { headers: gzip })
    expect(res.headers.get("Cache-Control")).toContain("no-transform")
    expect(res.headers.get("Content-Encoding")).toBe("gzip")
    expect(res.headers.get("Vary")).toBe("Accept-Encoding")
    const bytes = new Uint8Array(await res.arrayBuffer())
    expect(bytes.byteLength).toBeLessThan(page.length / 10)
    expect(new TextDecoder().decode(Bun.gunzipSync(bytes))).toBe(page)
  })

  test("route-set public JSON is gzipped", async () => {
    const json = JSON.stringify(
      Array.from({ length: 400 }, (_, i) => ({ code: `32.${i}` })),
    )
    const app = appWith({
      handleDocument: async () =>
        Response.json(JSON.parse(json), {
          headers: { "Cache-Control": "public, max-age=0, no-transform" },
        }),
    }).app
    const res = await app.request(`${host}/wilayah/32.json`, { headers: gzip })
    expect(res.headers.get("Content-Encoding")).toBe("gzip")
    const bytes = new Uint8Array(await res.arrayBuffer())
    expect(new TextDecoder().decode(Bun.gunzipSync(bytes))).toBe(json)
  })

  test("clients without gzip get raw bytes", async () => {
    const app = serving(page, "text/html; charset=utf-8")
    const variants: Record<string, string>[] = [
      {},
      { "Accept-Encoding": "br, gzip;q=0" },
    ]
    for (const headers of variants) {
      const res = await app.request(`${host}/isu`, { headers })
      expect(res.headers.has("Content-Encoding")).toBe(false)
      expect(res.headers.get("Vary")).toBe("Accept-Encoding")
      expect(await res.text()).toBe(page)
    }
  })

  test("the edge compresses what it may transform", async () => {
    const app = serving(page, "text/html; charset=utf-8")
    const res = await app.request(`${host}/lapor`, { headers: gzip })
    expect(res.headers.get("Cache-Control")).toBe("private, no-store")
    expect(res.headers.has("Content-Encoding")).toBe(false)
    expect(await res.text()).toBe(page)
  })

  test("images, small bodies and redirects stay raw", async () => {
    const png = serving(page, "image/png")
    const image = await png.request(`${host}/isu/ISU-ITB-26-0001/og.png`, {
      headers: gzip,
    })
    expect(image.headers.has("Content-Encoding")).toBe(false)
    const tiny = serving("<p>ok</p>", "text/html; charset=utf-8")
    const small = await tiny.request(`${host}/isu`, { headers: gzip })
    expect(small.headers.has("Content-Encoding")).toBe(false)
    expect(await small.text()).toBe("<p>ok</p>")
    const moved = await appWith().app.request(`${host}/isu?x=1`, {
      headers: gzip,
    })
    expect(moved.status).toBe(301)
    expect(moved.headers.has("Content-Encoding")).toBe(false)
  })
})

describe("canonical query", () => {
  test("unknown parameters 301 to the canonical relative URL", async () => {
    const { app, seen } = appWith()
    const res = await app.request(`${host}/isu?fbclid=x&utm_source=wa`)
    expect(res.status).toBe(301)
    expect(res.headers.get("Location")).toBe("/isu")
    expect(res.headers.get("Cloudflare-CDN-Cache-Control")).toContain(
      "max-age=60",
    )
    expect(seen).toEqual([])
  })

  test("data requests, writes and private routes pass through", async () => {
    const { app, seen } = appWith()
    await app.request(`${host}/isu.data?fbclid=x`)
    await app.request(`${host}/lapor?fbclid=x`)
    await app.request(`${host}/isu?fbclid=x`, {
      method: "POST",
      headers: { origin: host },
    })
    expect(seen).toHaveLength(3)
  })

  test("React Router parameters cannot bust the cache", async () => {
    const { app, seen } = appWith()
    for (const [url, location] of [
      ["/?index=r1", "/"],
      ["/isu?_routes=x&q=abcd", "/isu?q=abcd"],
      ["/isu/ISU-ITB-26-0001?index=zz", "/isu/ISU-ITB-26-0001"],
      [
        "/isu/ISU-ITB-26-0001/og.png?v=1&index=r1",
        "/isu/ISU-ITB-26-0001/og.png?v=1",
      ],
    ] as const) {
      const res = await app.request(`${host}${url}`)
      expect([url, res.status, res.headers.get("Location")]).toEqual([
        url,
        301,
        location,
      ])
    }
    expect(seen).toEqual([])
  })

  test("canonical URLs pass through", async () => {
    const { app, seen } = appWith()
    const res = await app.request(`${host}/isu?urut=aktivitas`)
    expect(res.status).toBe(200)
    expect(seen).toHaveLength(1)
  })
})

describe("security headers", () => {
  test("every response carries the static set", async () => {
    const { app } = appWith()
    for (const path of ["/healthz", "/isu"]) {
      const res = await app.request(`${host}${path}`)
      expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff")
      expect(res.headers.get("Referrer-Policy")).toBe(
        "strict-origin-when-cross-origin",
      )
      expect(res.headers.get("Permissions-Policy")).toContain(
        "geolocation=(self)",
      )
    }
  })

  test("HSTS only over the public https origin", async () => {
    const { app } = appWith()
    const plain = await app.request(`${host}/isu`)
    expect(plain.headers.has("Strict-Transport-Security")).toBe(false)
    const tls = await app.request(`${host}/isu`, {
      headers: { "x-forwarded-proto": "https" },
    })
    expect(tls.headers.get("Strict-Transport-Security")).toBe("max-age=300")
  })

  test("HSTS takes the configured launch policy", async () => {
    // ASVS V3.4.1: one year, subdomains
    const policy = "max-age=31536000; includeSubDomains"
    const { app } = appWith({ hsts: policy })
    const tls = await app.request(`${host}/isu`, {
      headers: { "x-forwarded-proto": "https" },
    })
    expect(tls.headers.get("Strict-Transport-Security")).toBe(policy)
  })

  test("text bodies always name a charset", async () => {
    // ASVS V4.1.1: single-fetch data
    for (const [type, expected] of [
      ["text/x-script", "text/x-script; charset=utf-8"],
      ["text/html; charset=utf-8", "text/html; charset=utf-8"],
      [
        "text/csv; charset=utf-8; header=present",
        "text/csv; charset=utf-8; header=present",
      ],
      ["application/json", "application/json"],
      ["image/svg+xml", "image/svg+xml; charset=utf-8"],
    ]) {
      const { app } = appWith({
        handleDocument: async () =>
          new Response("x", { headers: { "Content-Type": type ?? "" } }),
      })
      const res = await app.request(`${host}/isu.data`)
      expect([type, res.headers.get("Content-Type")]).toEqual([type, expected])
    }
  })

  test("every own CSP forbids framing", async () => {
    // ASVS V3.4.6: file responses too
    for (const [given, expected] of [
      [
        "sandbox; default-src 'none'",
        "sandbox; default-src 'none'; frame-ancestors 'none'",
      ],
      [
        "default-src 'self'; frame-ancestors 'none'",
        "default-src 'self'; frame-ancestors 'none'",
      ],
      [
        "default-src 'self'; frame-ancestors 'self'",
        "default-src 'self'; frame-ancestors 'self'",
      ],
    ]) {
      const { app } = appWith({
        handleDocument: async () =>
          new Response("x", {
            headers: { "Content-Security-Policy": given ?? "" },
          }),
      })
      const res = await app.request(`${host}/logo/abc.webp`)
      expect(res.headers.get("Content-Security-Policy")).toBe(expected ?? "")
    }
  })

  test("a page CSP is kept, other responses get a strict default", async () => {
    const { app } = appWith({
      handleDocument: async () =>
        new Response("<p>", {
          headers: { "Content-Security-Policy": "default-src 'self'" },
        }),
    })
    const page = await app.request(`${host}/isu`)
    expect(page.headers.get("Content-Security-Policy")).toBe(
      "default-src 'self'; frame-ancestors 'none'",
    )
    const health = await app.request(`${host}/healthz`)
    expect(health.headers.get("Content-Security-Policy")).toBe(
      "default-src 'none'; frame-ancestors 'none'",
    )
  })
})

describe("malformed input", () => {
  // OWASP A05: NUL stops early
  test("NUL or broken escapes in a path or query are 400", async () => {
    const { app, seen } = appWith({ clientDir: import.meta.dir })
    for (const path of [
      "/isu/%00",
      "/x%00.js",
      "/isu?q=%00abc",
      "/api/v1/isu?q=%00abc",
      "/isu/%E0%A4%A",
      "/isu?q=%E0%A4%A",
    ]) {
      const res = await app.request(`${host}${path}`)
      expect([path, res.status]).toEqual([path, 400])
      expect(res.headers.get("Cache-Control")).toBe("no-store")
    }
    expect(seen).toEqual([])
    for (const path of ["/isu?urut=aktivitas", "/isu/jalan%20rusak"]) {
      const fine = await app.request(`${host}${path}`)
      expect([path, fine.status]).toEqual([path, 200])
    }
  })
})

describe("malformed bodies", () => {
  // OWASP A05: NUL never stored
  test("a NUL in a form or JSON value is 400", async () => {
    const { app, seen } = appWith()
    const post = (body: string, type: string) =>
      app.request(`${host}/lapor/kirim`, {
        method: "POST",
        headers: { "content-type": type },
        body,
      })
    const form = "application/x-www-form-urlencoded"
    for (const [body, type] of [
      ["title=a%00b", form],
      [JSON.stringify({ report: { title: "a\u0000b" } }), "application/json"],
      [
        JSON.stringify(["x", { y: ["\u0000"] }]),
        "application/json; charset=utf-8",
      ],
    ]) {
      const res = await post(body ?? "", type ?? "")
      expect([body, res.status]).toEqual([body, 400])
    }
    expect(seen).toEqual([])
    expect((await post("title=jalan+rusak", form)).status).toBe(200)
    expect(
      (await post('{"title":"a\\\\u0000"}', "application/json")).status,
    ).toBe(200)
    const file = new FormData()
    file.set("logo", new Blob([new Uint8Array([0, 1, 0])]), "a.png")
    const multipart = await app.request(`${host}/kelola/pengaturan`, {
      method: "POST",
      body: file,
    })
    expect(multipart.status).toBe(200)
  })

  test("media type case and multipart never skip the check", async () => {
    const { app, seen } = appWith()
    const post = (body: BodyInit, type?: string) =>
      app.request(`${host}/lapor/kirim`, {
        method: "POST",
        ...(type ? { headers: { "content-type": type } } : {}),
        body,
      })
    const json = JSON.stringify({ title: "a\u0000b" })
    const parts = new FormData()
    parts.set("title", "a\u0000b")
    for (const [body, type] of [
      ["title=a%00b", "Application/X-WWW-Form-Urlencoded"],
      ["title=a%00b", " APPLICATION/X-WWW-FORM-URLENCODED ; charset=utf-8"],
      [json, "APPLICATION/JSON"],
      [json, "application/vnd.api+json"],
      [json, "text/plain;charset=UTF-8"],
      [parts, undefined],
    ] as const) {
      const res = await post(body, type)
      expect([type, res.status]).toEqual([type, 400])
      expect(res.headers.get("Cache-Control")).toBe("no-store")
    }
    expect(seen).toEqual([])
    const fine = new FormData()
    fine.set("title", "jalan rusak")
    expect((await post(fine)).status).toBe(200)
    expect((await post("halo", "text/plain")).status).toBe(200)
  })
})

describe("malformed bodies, streamed", () => {
  test("an oversize chunked form is still 413, not an error", async () => {
    const errors: Record<string, unknown>[] = []
    const { app } = appWith({ errorLog: (line) => errors.push(line) })
    const chunk = new TextEncoder().encode("a".repeat(64 * 1024))
    let sent = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent++ < 4) controller.enqueue(chunk)
        else controller.close()
      },
    })
    const res = await app.request(`${host}/lapor/kirim`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      duplex: "half",
    } as RequestInit)
    expect(res.status).toBe(413)
    expect(errors).toEqual([])
  })
})

describe("host", () => {
  test("a non-canonical Host header is 404 before React Router", async () => {
    const { app, seen } = appWith()
    for (const raw of [
      "ITB.localhost",
      "itb.localhost.",
      "itb.localhost:8080",
    ]) {
      for (const proto of ["http", "https"]) {
        const res = await app.request(`${host}/isu`, {
          headers: { host: raw, "x-forwarded-proto": proto },
        })
        expect([raw, proto, res.status]).toEqual([raw, proto, 404])
        expect(res.headers.get("Cache-Control")).toBe("no-store")
      }
    }
    expect(seen).toEqual([])
  })

  test("the canonical Host and health checks pass", async () => {
    const { app, seen } = appWith()
    const page = await app.request(`${host}/isu`, {
      headers: { host: "itb.localhost" },
    })
    expect(page.status).toBe(200)
    const health = await app.request(`${host}/healthz`, {
      headers: { host: "127.0.0.1:3000" },
    })
    expect(health.status).toBe(200)
    expect(seen).toHaveLength(1)
  })
})

function chunked(bytes: number, pulled: { total: number }) {
  const chunk = new Uint8Array(16 * 1024)
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulled.total >= bytes) return controller.close()
      pulled.total += chunk.byteLength
      controller.enqueue(chunk)
    },
  })
}

describe("body limit", () => {
  test("a chunked body over the form cap is 413 without reaching React Router", async () => {
    const { app, seen } = appWith()
    for (const path of [
      "/lapor/periksa",
      "/masuk/dua-langkah",
      "/api/auth/account/verify-code",
    ]) {
      const pulled = { total: 0 }
      const res = await app.request(`${host}${path}`, {
        method: "POST",
        body: chunked(8 * 1024 * 1024, pulled),
        duplex: "half",
        headers: { origin: host },
      } as RequestInit)
      expect([path, res.status]).toEqual([path, 413])
      expect(pulled.total).toBeLessThan(MAX_FORM_BODY + 64 * 1024)
    }
    expect(seen).toEqual([])
  })

  test("a policy brief upload gets its own larger cap", async () => {
    const bodies: number[] = []
    const { app } = appWith({
      handleDocument: async (request) => {
        bodies.push((await request.arrayBuffer()).byteLength)
        return new Response("ok")
      },
    })
    const path = "/kelola/tuntutan/TUN-ITB-26-0001/unggah"
    const fits = await app.request(`${host}${path}`, {
      method: "POST",
      body: "x".repeat(2 * 1024 * 1024),
      headers: { origin: host },
    })
    expect(fits.status).toBe(200)
    expect(bodies).toEqual([2 * 1024 * 1024])
    const pulled = { total: 0 }
    const over = await app.request(`${host}${path}`, {
      method: "POST",
      body: chunked(MAX_BRIEF_BODY + 1024 * 1024, pulled),
      duplex: "half",
      headers: { origin: host },
    } as RequestInit)
    expect(over.status).toBe(413)
    // Other posts keep form cap
    const form = await app.request(`${host}/kelola/tuntutan/TUN-ITB-26-0001`, {
      method: "POST",
      body: "x".repeat(MAX_FORM_BODY + 1),
      headers: { origin: host },
    })
    expect(form.status).toBe(413)
  })

  test("a declared length over the cap is 413", async () => {
    const { app } = appWith()
    const res = await app.request(`${host}/lapor/periksa`, {
      method: "POST",
      body: "x".repeat(MAX_FORM_BODY + 1),
      headers: { origin: host },
    })
    expect(res.status).toBe(413)
    // Indonesian, never the English default
    expect(await res.text()).toBe(m.error_body_too_large())
    expect(res.headers.get("content-type")).toContain("text/plain")
  })

  test("a small chunked body reaches React Router intact", async () => {
    const bodies: number[] = []
    const { app } = appWith({
      handleDocument: async (request) => {
        bodies.push((await request.arrayBuffer()).byteLength)
        return new Response("ok")
      },
    })
    const pulled = { total: 0 }
    const res = await app.request(`${host}/lapor/periksa`, {
      method: "POST",
      body: chunked(32 * 1024, pulled),
      duplex: "half",
    } as RequestInit)
    expect(res.status).toBe(200)
    expect(bodies).toEqual([32 * 1024])
  })

  test("uploads stream past the form cap", async () => {
    const sizes: number[] = []
    const { app } = appWith({
      handleDocument: async (request) => {
        sizes.push((await request.arrayBuffer()).byteLength)
        return new Response("ok")
      },
    })
    for (const method of ["POST", "PATCH"]) {
      await app.request(`${host}/api/upload/${UPLOAD_ID}`, {
        method,
        body: chunked(1024 * 1024, { total: 0 }),
        duplex: "half",
      } as RequestInit)
    }
    expect(sizes).toEqual([1024 * 1024, 1024 * 1024])
  })

  test("the server refuses bodies past the largest upload", async () => {
    // Video is the largest kind
    expect(SERVE_LIMITS.maxRequestBodySize).toBeGreaterThan(
      EVIDENCE_LIMITS.video,
    )
    const { app } = appWith({
      handleDocument: async (request) => {
        // Bun aborts the stream
        await request.arrayBuffer().catch(() => {})
        return new Response("ok")
      },
    })
    const server = Bun.serve({ port: 0, ...SERVE_LIMITS, fetch: app.fetch })
    try {
      const pulled = { total: 0 }
      const res = await fetch(`${server.url}api/upload/${UPLOAD_ID}`, {
        method: "POST",
        body: chunked(SERVE_LIMITS.maxRequestBodySize + 1024 * 1024, pulled),
        duplex: "half",
        headers: { host: "itb.localhost" },
      } as RequestInit).catch(() => null)
      expect(res?.status ?? 413).toBe(413)
    } finally {
      server.stop(true)
    }
  })
})

const UPLOAD_ID = "0199c2b0-1d2e-7000-8000-000000000001"

describe("load shed", () => {
  test("the busy text comes from Paraglide", async () => {
    const shed = new Hono()
      .use(loadShed(0, () => true))
      .get("/", (c) => c.text("ok"))
    const res = await shed.request("/")
    expect(res.status).toBe(503)
    expect(await res.text()).toBe(messages.error_busy_body)
  })

  test("only evidence uploads skip the page cap", async () => {
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const { app } = appWith({
      maxInFlight: 1,
      handleDocument: async () => {
        await gate
        return new Response("ok")
      },
    })
    const first = app.request(`${host}/isu`)
    for (const [method, path] of [
      ["GET", `/api/upload/${UPLOAD_ID}`],
      ["POST", "/api/upload/not-a-uuid"],
    ] as const) {
      const res = await app.request(`${host}${path}`, {
        method,
        headers: { origin: host },
      })
      expect([method, path, res.status]).toEqual([method, path, 503])
    }
    release()
    await first
  })

  test("uploads have their own cap", async () => {
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const { app } = appWith({
      maxInFlight: 1,
      maxUploadsInFlight: 1,
      handleDocument: async () => {
        await gate
        return new Response("ok")
      },
    })
    const upload = (id: string, method = "POST") =>
      app.request(`${host}/api/upload/${id}`, {
        method,
        headers: { origin: host },
      })
    const first = upload(UPLOAD_ID)
    const second = await upload(UPLOAD_ID.replace(/1$/, "2"))
    expect(second.status).toBe(503)
    // tus append shares the slots
    const patch = await upload(UPLOAD_ID.replace(/1$/, "3"), "PATCH")
    expect(patch.status).toBe(503)
    release()
    expect((await first).status).toBe(200)
  })

  test("rejects SSR beyond the cap but not uploads", async () => {
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const { app } = appWith({
      maxInFlight: 1,
      handleDocument: async () => {
        await gate
        return new Response("ok")
      },
    })
    const first = app.request(`${host}/isu`)
    const second = await app.request(`${host}/isu`)
    expect(second.status).toBe(503)
    expect(second.headers.get("Retry-After")).toBe("5")
    expect(second.headers.get("Cache-Control")).toBe("no-store")
    const upload = app.request(`${host}/api/upload/${UPLOAD_ID}`, {
      method: "POST",
    })
    release()
    expect((await first).status).toBe(200)
    expect((await upload).status).toBe(200)
    const after = await app.request(`${host}/isu`)
    expect(after.status).toBe(200)
  })
})

describe("request log", () => {
  test("one JSON line without query or client IP", async () => {
    const { app, lines } = appWith()
    await app.request(`${host}/isu?q=rahasia`, {
      headers: {
        "x-client-ip": "203.0.113.7",
        "cf-ray": "8f1e2d3c4b5a6978-CGK",
      },
    })
    expect(lines).toHaveLength(1)
    const line = lines[0] ?? {}
    expect(line.path).toBe("/isu")
    expect(line.host).toBe("itb.localhost")
    expect(line.status).toBe(200)
    expect(line.req_id).toBe("8f1e2d3c4b5a6978-CGK")
    expect(typeof line.dur_ms).toBe("number")
    expect(JSON.stringify(line)).not.toContain("203.0.113.7")
    expect(JSON.stringify(line)).not.toContain("rahasia")
  })

  test("a signed-in request names its account", async () => {
    const { app, lines } = appWith({
      handleDocument: async () => {
        const scope = requestScope()
        if (scope) scope.userId = "user-1"
        return new Response("ok")
      },
    })
    await app.request(`${host}/isu`)
    expect(lines[0]?.user_id).toBe("user-1")
    const anon = appWith()
    await anon.app.request(`${host}/isu`)
    expect(anon.lines[0]?.user_id).toBeNull()
  })

  test("private codes and ids never reach the log", async () => {
    const id = "0199c2b0-1d2e-7000-8000-00000000abcd"
    const cases: [string, string][] = [
      ["/lapor/sukses/ITB-26-ABCDE", "/lapor/sukses/:code"],
      ["/aduan/A-26-QWERT", "/aduan/:code"],
      [`/undangan/${id}`, "/undangan/:id"],
      [
        "/kelola/laporan/ITB-26-ABCDE/tutup-akun",
        "/kelola/laporan/:code/tutup-akun",
      ],
      ["/kelola/aduan/A-26-QWERT", "/kelola/aduan/:code"],
      [`/kelola/bukti/${id}/asli`, "/kelola/bukti/:id/asli"],
      ["/KELOLA/Laporan/ITB-26-ABCDE", "/KELOLA/Laporan/:code"],
      ["/isu/ITB-26-0001", "/isu/ITB-26-0001"],
    ]
    for (const [path, logged] of cases) {
      const { app, lines } = appWith()
      await app.request(`${host}${path}`)
      expect(lines[0]?.path).toBe(logged)
    }
  })
})

describe("unhandled errors", () => {
  const PHONE = "+6281299998888"

  test("logged without values, plain 500", async () => {
    const errors: Record<string, unknown>[] = []
    const { app } = appWith({
      handleDocument: async () => {
        throw new DrizzleQueryError("select $1", [PHONE], new Error("x"))
      },
      errorLog: (line) => errors.push(line),
    })
    const res = await app.request(`${host}/isu`)
    expect(res.status).toBe(500)
    expect(res.headers.get("Cache-Control")).toBe("no-store")
    expect(await res.text()).toBe("Internal Server Error")
    expect(JSON.stringify(errors)).not.toContain(PHONE)
    expect(errors).toEqual([
      expect.objectContaining({
        msg: "server error",
        path: "/isu",
        error: "Error",
        req_id: expect.any(String),
      }),
    ])
  })

  test("HTTP exceptions keep their response", async () => {
    const errors: Record<string, unknown>[] = []
    const { app } = appWith({
      handleDocument: async () => {
        throw new HTTPException(418, { message: "teapot" })
      },
      errorLog: (line) => errors.push(line),
    })
    const res = await app.request(`${host}/isu`)
    expect(res.status).toBe(418)
    expect(errors).toEqual([])
  })
})

describe("security events", () => {
  const events = (lines: Record<string, unknown>[]) =>
    lines.filter((line) => line.msg === "security")

  test("a 429 is logged with its subject", async () => {
    const { app, lines } = appWith({
      handleDocument: async () => {
        const scope = requestScope()
        if (scope) scope.userId = "user-1"
        return new Response("slow down", { status: 429 })
      },
    })
    await app.request(`${host}/api/auth/account/send-code`, { method: "POST" })
    expect(events(lines)).toEqual([
      expect.objectContaining({
        event: "rate_limited",
        host: "itb.localhost",
        path: "/api/auth/account/send-code",
        status: 429,
        user_id: "user-1",
      }),
    ])
  })

  test("any other refusal gets one named line", async () => {
    for (const [status, event] of [
      [401, "unauthenticated"],
      [403, "forbidden"],
    ] as const) {
      const { app, lines } = appWith({
        handleDocument: async () => new Response(null, { status }),
      })
      await app.request(`${host}/kelola/laporan/ITB-26-ABCDE`)
      expect(events(lines)).toEqual([
        expect.objectContaining({
          event,
          status,
          path: "/kelola/laporan/:code",
        }),
      ])
    }
  })

  test("a refusal already named is not repeated", async () => {
    const { app, lines } = appWith({
      handleDocument: async () => {
        lines.push(securityRecord("csrf_refused", { host: "itb.localhost" }))
        return new Response(null, { status: 403 })
      },
    })
    await app.request(`${host}/isu`)
    expect(events(lines).map((line) => line.event)).toEqual(["csrf_refused"])
  })

  test("an oversize body is logged", async () => {
    const { app, lines } = appWith()
    await app.request(`${host}/lapor/periksa`, {
      method: "POST",
      body: "x".repeat(MAX_FORM_BODY + 1),
      headers: { origin: host },
    })
    expect(events(lines)).toEqual([
      expect.objectContaining({ event: "body_limit", status: 413 }),
    ])
  })

  test("a non-canonical host is logged", async () => {
    const { app, lines } = appWith()
    await app.request(`${host}/isu`, { headers: { host: "ITB.localhost" } })
    expect(events(lines)).toEqual([
      expect.objectContaining({ event: "bad_host", path: "/isu" }),
    ])
  })

  test("an unroutable path is logged, with headers", async () => {
    for (const path of ["/isu%0Ax", "/isu%0Dx", "/isu%E2%80%A8x"]) {
      const { app, lines, seen } = appWith()
      const res = await app.request(`${host}${path}`)
      expect([path, res.status]).toEqual([path, 404])
      expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff")
      expect(res.headers.get("Content-Security-Policy")).toContain(
        "frame-ancestors 'none'",
      )
      expect(res.headers.get("Cache-Control")).toBe("no-store")
      expect(seen).toEqual([])
      expect(lines.map((line) => [line.msg, line.event ?? null])).toEqual([
        ["security", "unrouted_path"],
        ["request", null],
      ])
      expect(typeof lines[1]?.req_id).toBe("string")
    }
  })
})
