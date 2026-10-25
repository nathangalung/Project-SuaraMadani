import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { drizzle } from "drizzle-orm/node-postgres"
import { migrate } from "../db/migrate.ts"
import { issues } from "../db/schema/issues.ts"
import {
  insertOrg,
  insertRegions,
  resetData,
  superuserPool,
  testUrl,
} from "../db/testing.ts"
import {
  dropJobs,
  type FullApp,
  fullApp,
  hostsChanged,
  loaderWith,
  signedIn,
  stubTurnstile,
} from "../e2e/app-harness.ts"
import { submitReport } from "../e2e/staff-flows.ts"

const HOST = "accpub.localhost"
const ORIGIN = `http://${HOST}`
const APEX = "http://localhost"
const PUBLISHED = "ISU-ACCPUB-26-0001"
const HIDDEN = "ISU-ACCPUB-26-0002"
const TOKEN = "t".repeat(40)
const su = superuserPool()
let app: FullApp
let restore = () => {}
let pendingTitle = ""

const PUBLIC_CACHE = "public, max-age=0, no-transform"
const CDN = "max-age=60, stale-while-revalidate=30, stale-if-error=86400"

beforeAll(async () => {
  await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
  await resetData(su)
  await insertRegions(su)
  const orgId = await insertOrg(su, "accpub")
  hostsChanged([HOST])
  const base = {
    orgId,
    year: 2026,
    summary: "Warga melaporkan lubang besar di jalan utama Dago.",
    categoryId: "program",
    subcategoryId: "program.infrastruktur",
    provinceCode: "32",
    regencyCode: "32.73",
    reportCount: 1,
  }
  await drizzle({ client: su })
    .insert(issues)
    .values([
      {
        ...base,
        number: 1,
        publicCode: PUBLISHED,
        title: "Jalan berlubang di Dago",
        publishedAt: new Date(),
      },
      {
        ...base,
        number: 2,
        publicCode: HIDDEN,
        title: "Gorong-gorong tersumbat belum diperiksa",
      },
    ])
  restore = stubTurnstile()
  app = await fullApp({ healthToken: TOKEN })
  const reporter = await signedIn(HOST, {
    email: "pelapor.publik@contoh.id",
    phone: "+6281244400001",
    name: "Pelapor Publik",
  })
  pendingTitle = "Pipa air bocor depan sekolah"
  await submitReport(app, HOST, reporter.cookie, {
    details: {
      title: pendingTitle,
      story: "Pipa air bocor di depan sekolah dan airnya menggenangi jalan.",
      categoryId: "program",
      subcategoryId: "program.infrastruktur",
      occurredOn: "2026-10-01",
      urgency: "medium",
    },
  })
})

afterAll(async () => {
  await dropJobs(su, [HOST])
  // Later files rebuild auth
  hostsChanged([HOST])
  restore()
  await resetData(su)
  await su.end()
})

describe("public pages", () => {
  test("[AC-PUBLIC-01] Given a report not yet reviewed and an unpublished issue, when the public pages, search and OG images are read, then neither appears anywhere", async () => {
    for (const path of [`/isu/${HIDDEN}`, `/isu/${HIDDEN}/og.png`]) {
      expect((await app.request(`${ORIGIN}${path}`)).status).toBe(404)
    }
    const pages = [
      "/",
      "/isu",
      "/isu?q=Gorong",
      "/isu?q=Pipa",
      "/tuntutan",
      `/api/v1/isu`,
    ]
    for (const path of pages) {
      const res = await app.request(`${ORIGIN}${path}`)
      expect(res.status).toBe(200)
      const body = await res.text()
      expect(body).not.toContain("Gorong-gorong tersumbat")
      expect(body).not.toContain(pendingTitle)
    }
    expect(await (await app.request(`${ORIGIN}/isu`)).text()).toContain(
      PUBLISHED,
    )
    const bare = await app.request(`${ORIGIN}/isu/${PUBLISHED}/og.png`)
    expect(bare.status).toBe(301)
    const og = await app.request(
      `${ORIGIN}${bare.headers.get("Location") ?? ""}`,
    )
    expect(og.status).toBe(200)
    expect(og.headers.get("Content-Type")).toBe("image/png")
  })

  test("[AC-PUBLIC-02] Given a public issue page, when it is read anonymously, with a session and as a missing page, then only the anonymous 200 is cacheable at the edge", async () => {
    const anon = await app.request(`${ORIGIN}/isu/${PUBLISHED}`)
    expect(anon.status).toBe(200)
    expect(anon.headers.get("Cache-Control")).toBe(PUBLIC_CACHE)
    expect(anon.headers.get("Cloudflare-CDN-Cache-Control")).toBe(CDN)
    expect(anon.headers.get("Set-Cookie")).toBeNull()
    const reader = await signedIn(HOST, {
      email: "pembaca@contoh.id",
      phone: "+6281244400002",
      name: "Pembaca",
    })
    const own = await app.request(`${ORIGIN}/isu/${PUBLISHED}`, {
      headers: { cookie: reader.cookie },
    })
    expect(own.status).toBe(200)
    expect(own.headers.get("Cache-Control")).toBe("private, no-store")
    expect(own.headers.get("Cloudflare-CDN-Cache-Control")).toBeNull()
    const missing = await app.request(`${ORIGIN}/isu/ISU-ACCPUB-26-0099`)
    expect(missing.status).toBe(404)
    expect(missing.headers.get("Cache-Control")).toBe("no-store")
  })

  test("[AC-PUBLIC-03] Given a shared link with tracking parameters, when a cacheable page is opened, then it redirects 301 to the canonical URL", async () => {
    const res = await app.request(
      `${ORIGIN}/isu?fbclid=abc&utm_source=x&kategori=program`,
    )
    expect(res.status).toBe(301)
    expect(res.headers.get("Location")).toBe("/isu?kategori=program")
    expect(res.headers.get("Cache-Control")).toBe(PUBLIC_CACHE)
  })

  test("[AC-PUBLIC-04] Given the issue list, when a two-character search or a page past 50 is asked for, then the page asks for a longer search or a narrower filter", async () => {
    const short = await app.request(`${ORIGIN}/isu.data?q=ab`)
    expect(short.status).toBe(200)
    const list = await loaderWith<{ result: { kind: string } }>(short, "result")
    expect(list.result.kind).toBe("short_query")
    const cursor = Buffer.from(
      JSON.stringify([
        51,
        "terbaru",
        "2026-10-01T00:00:00.000000Z",
        "01a15f4a-4b28-7836-a0ab-33ceed2ae16a",
      ]),
    ).toString("base64url")
    const capped = await app.request(`${ORIGIN}/isu?kursor=${cursor}`)
    expect(capped.status).toBe(200)
    // PLAN 6.1 quotes this text
    expect(await capped.text()).toContain("Persempit pencarian Anda")
  })

  test("[AC-PUBLIC-05] Given any HTML page, when it is served, then it carries a hash-based CSP, nosniff, a referrer policy, a permissions policy, HSTS and no-transform", async () => {
    // Caddy marks the TLS hop
    const res = await app.request(`${ORIGIN}/isu/${PUBLISHED}`, {
      headers: { "x-forwarded-proto": "https" },
    })
    const csp = res.headers.get("Content-Security-Policy") ?? ""
    expect(csp).toContain("'strict-dynamic'")
    expect(csp).toContain("frame-ancestors 'none'")
    const scriptSrc =
      csp
        .split(";")
        .map((directive) => directive.trim().split(" "))
        .find(([name]) => name === "script-src") ?? []
    expect(scriptSrc).not.toContain("'unsafe-inline'")
    expect(scriptSrc).not.toContain("'unsafe-eval'")
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff")
    expect(res.headers.get("Referrer-Policy")).toBe(
      "strict-origin-when-cross-origin",
    )
    expect(res.headers.get("Permissions-Policy")).toContain(
      "geolocation=(self)",
    )
    expect(res.headers.get("Strict-Transport-Security")).toBe("max-age=300")
    expect(res.headers.get("Cache-Control")).toContain("no-transform")
    const plain = await app.request(`${ORIGIN}/isu/${PUBLISHED}`)
    expect(plain.headers.get("Strict-Transport-Security")).toBeNull()
    const html = await res.text()
    // Every served inline script runs
    const inline = [
      ...html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g),
    ].map((match) => match[1] ?? "")
    expect(inline.length).toBeGreaterThan(0)
    for (const body of inline) {
      const digest = createHash("sha256").update(body).digest("base64")
      expect(scriptSrc).toContain(`'sha256-${digest}'`)
    }
  })

  test("[AC-PUBLIC-06] Given the region selects, when a province's children are asked for, then the JSON list is cacheable for a day and an unknown code is 404", async () => {
    const res = await app.request(`${ORIGIN}/wilayah/32.json`)
    expect(res.status).toBe(200)
    expect(res.headers.get("Cache-Control")).toBe(PUBLIC_CACHE)
    expect(res.headers.get("Cloudflare-CDN-Cache-Control")).toContain(
      "max-age=86400",
    )
    const children = await res.json()
    expect(JSON.stringify(children)).toContain("Kota Bandung")
    expect((await app.request(`${ORIGIN}/wilayah/99.json`)).status).toBe(404)
  })

  test("[AC-PUBLIC-07] Given the apex domain, when its home and any form or campus path are opened, then only the national view answers and the rest is 404", async () => {
    const home = await app.request(`${APEX}/`)
    expect(home.status).toBe(200)
    expect(home.headers.get("Cache-Control")).toBe(PUBLIC_CACHE)
    const html = await home.text()
    expect(html).not.toMatch(/<form/i)
    expect(html).toContain("accpub.localhost")
    for (const path of [
      "/tuntutan",
      "/lapor",
      "/masuk",
      "/kelola",
      "/isu",
      "/api/v1",
    ]) {
      expect((await app.request(`${APEX}${path}`)).status).toBe(404)
    }
  })

  test("[AC-PUBLIC-08] Given a request for an unknown campus or a Host header that is not canonical, when it arrives, then it is 404 before any page runs", async () => {
    const unknown = await app.request("http://nobody.localhost/isu")
    expect(unknown.status).toBe(404)
    expect(unknown.headers.get("Cache-Control")).toBe("no-store")
    for (const host of ["ACCPUB.localhost", "accpub.localhost."]) {
      const res = await app.request(`${ORIGIN}/isu`, { headers: { host } })
      expect(res.status).toBe(404)
      expect(res.headers.get("Cache-Control")).toBe("no-store")
    }
  })

  test("[AC-PUBLIC-09] Given uptime monitors, when they call /healthz and /healthz/jobs, then the answers are never cached and job details need the bearer token", async () => {
    const health = await app.request(`${ORIGIN}/healthz`)
    expect(health.status).toBe(200)
    expect(health.headers.get("Cache-Control")).toBe("no-store")
    expect(await health.json()).toEqual({ status: "ok", sha: "acceptance" })
    const open = await app.request(`${ORIGIN}/healthz/jobs`)
    expect(open.headers.get("Cache-Control")).toBe("no-store")
    expect(Object.keys(await open.json())).toEqual(["ok"])
    const detailed = await app.request(`${ORIGIN}/healthz/jobs`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    })
    expect(detailed.headers.get("Cache-Control")).toBe("no-store")
    const body = await detailed.json()
    expect(Object.keys(body).sort()).toEqual(["checks", "ok"])
  })

  test("[AC-PUBLIC-10] Given hostile input, when a URL carries a NUL byte or a form body is over 128 KB, then the server answers 400 or 413 without running the page", async () => {
    const nul = await app.request(`${ORIGIN}/isu?q=a%00b`)
    expect(nul.status).toBe(400)
    expect(nul.headers.get("Cache-Control")).toBe("no-store")
    const big = await app.request(`${ORIGIN}/masuk`, {
      method: "POST",
      headers: {
        origin: ORIGIN,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: `x=${"a".repeat(130 * 1024)}`,
    })
    expect(big.status).toBe(413)
    expect(big.headers.get("Cache-Control")).toBe("no-store")
  })
})
