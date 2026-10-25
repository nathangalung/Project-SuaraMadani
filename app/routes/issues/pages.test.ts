import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { drizzle } from "drizzle-orm/node-postgres"
import {
  createRequestHandler,
  type ServerBuild,
  UNSAFE_withComponentProps,
  UNSAFE_withErrorBoundaryProps,
} from "react-router"
import { m } from "~/paraglide/messages.js"
import { QUEUES } from "../../../db/jobs.server.ts"
import { migrate } from "../../../db/migrate.ts"
import { issues } from "../../../db/schema/issues.ts"
import {
  insertOrg,
  insertRegions,
  insertUser,
  resetData,
  superuserPool,
  testUrl,
} from "../../../db/testing.ts"
import { createApp } from "../../../server/app.ts"
import {
  CATEGORY_FILTERS,
  type DashboardSnapshot,
  filterKey,
  STATUS_FILTERS,
} from "../../../shared/dashboard.ts"
import * as entry from "../../entry.server.tsx"
import {
  changeDemandState,
  createDemand,
  type DemandFields,
  type DemandTenant,
  getManagedDemand,
  linkIssue,
  recordItemUpdate,
} from "../../features/demands/manage.server.ts"
import * as root from "../../root.tsx"
import * as data from "../data.tsx"
import * as demandDetail from "../demands/detail.tsx"
import * as demandList from "../demands/list.tsx"
import * as home from "../home.tsx"
import * as notFound from "../not-found.tsx"
import * as about from "../pages/about.tsx"
import * as accessibility from "../pages/accessibility.tsx"
import * as guidelines from "../pages/guidelines.tsx"
import * as privacy from "../pages/privacy.tsx"
import * as detail from "./detail.tsx"
import * as list from "./list.tsx"
import * as ogImage from "./og-image.ts"

// Full stack through Hono
const su = superuserPool()
const suDb = drizzle({ client: su })
// Tenant cache is per-process
const ITB = "http://itbpub.localhost"
const UGM = "http://ugmpub.localhost"
const KM = "http://kmpub.localhost"
const PUBLISHED = "ISU-ITBPUB-26-0001"
const DRAFT = "ISU-ITBPUB-26-0002"
const TAKEN = "ISU-ITBPUB-26-0003"
const EDITED = "ISU-ITBPUB-26-0004"

type ServerModule = NonNullable<ServerBuild["routes"][string]>["module"]

// Mirrors the Vite plugin
function routeModule(
  module: object,
  wrap: { default?: unknown; ErrorBoundary?: unknown } = {},
): ServerModule {
  const wrapped = {
    ...module,
    ...(wrap.default
      ? { default: UNSAFE_withComponentProps(wrap.default as RouteComponent) }
      : {}),
    ...(wrap.ErrorBoundary
      ? {
          ErrorBoundary: UNSAFE_withErrorBoundaryProps(
            wrap.ErrorBoundary as ErrorBoundaryComponent,
          ),
        }
      : {}),
  }
  return wrapped as ServerModule
}

type RouteComponent = Parameters<typeof UNSAFE_withComponentProps>[0]
type ErrorBoundaryComponent = Parameters<
  typeof UNSAFE_withErrorBoundaryProps
>[0]

const modules: Record<
  string,
  { path?: string; index?: boolean; module: ServerModule }
> = {
  root: { path: "", module: routeModule(root, root) },
  "routes/home": { index: true, module: routeModule(home, home) },
  "routes/issues/list": { path: "isu", module: routeModule(list, list) },
  "routes/issues/detail": {
    path: "isu/:code",
    module: routeModule(detail, detail),
  },
  "routes/issues/og-image": {
    path: "isu/:code/og.png",
    module: routeModule(ogImage),
  },
  "routes/pages/about": { path: "tentang", module: routeModule(about, about) },
  "routes/demands/list": {
    path: "tuntutan",
    module: routeModule(demandList, demandList),
  },
  "routes/demands/detail": {
    path: "tuntutan/:code",
    module: routeModule(demandDetail, demandDetail),
  },
  "routes/data": { path: "data", module: routeModule(data, data) },
  "routes/pages/privacy": {
    path: "privasi",
    module: routeModule(privacy, privacy),
  },
  "routes/pages/guidelines": {
    path: "pedoman",
    module: routeModule(guidelines, guidelines),
  },
  "routes/pages/accessibility": {
    path: "aksesibilitas",
    module: routeModule(accessibility, accessibility),
  },
  "routes/not-found": {
    path: "*",
    module: routeModule(notFound, notFound),
  },
}

function buildFor(): ServerBuild {
  const routes: ServerBuild["routes"] = {}
  const assets: ServerBuild["assets"]["routes"] = {}
  for (const [id, { path, index, module }] of Object.entries(modules)) {
    const parentId = id === "root" ? undefined : "root"
    routes[id] = { id, parentId, path, index, module }
    assets[id] = {
      id,
      parentId,
      path,
      index,
      module: `/${id}.js`,
      hasAction: false,
      hasLoader: "loader" in module,
      hasClientAction: false,
      hasClientLoader: false,
      hasClientMiddleware: false,
      hasErrorBoundary: "ErrorBoundary" in module,
      clientActionModule: undefined,
      clientLoaderModule: undefined,
      clientMiddlewareModule: undefined,
      hydrateFallbackModule: undefined,
    }
  }
  return {
    entry: { module: entry },
    routes,
    assets: {
      entry: { imports: [], module: "/entry.client.js" },
      routes: assets,
      url: "/manifest.js",
      version: "test",
    },
    publicPath: "/",
    assetsBuildDirectory: "build/client",
    future: {},
    ssr: true,
    isSpaMode: false,
    prerender: [],
    routeDiscovery: { mode: "initial", manifestPath: "/__manifest" },
  }
}

const handler = createRequestHandler(buildFor(), "production")
const app = createApp({
  handleDocument: (request) => handler(request),
  health: { db: async () => {}, jobs: async () => ({ ok: true, checks: {} }) },
  log: () => {},
})

function get(url: string) {
  return app.request(url)
}

function expectPublic(res: Response) {
  expect(res.headers.get("Cache-Control")).toBe(
    "public, max-age=0, no-transform",
  )
  expect(res.headers.get("Cloudflare-CDN-Cache-Control")).toBe(
    "max-age=60, stale-while-revalidate=30, stale-if-error=86400",
  )
  expect(res.headers.get("Set-Cookie")).toBeNull()
}

function expectNotFound(res: Response) {
  expect(res.status).toBe(404)
  expect(res.headers.get("Cache-Control")).toBe("no-store")
  expect(res.headers.get("Cloudflare-CDN-Cache-Control")).toBeNull()
}

beforeAll(async () => {
  await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
  await resetData(su)
  await insertRegions(su)
  const orgId = await insertOrg(su, "itbpub")
  await insertOrg(su, "ugmpub")
  // Before any request, tenant cache
  const kmId = await insertOrg(su, "kmpub")
  await su.query(
    `UPDATE organizations SET theme = '{"brandAssets":"km-itb"}',
       settings = '{"credit":" CSTS, KM ITB "}', contact_email = 'kontak@km.contoh.id'
     WHERE id = $1`,
    [kmId],
  )
  const base = {
    orgId,
    year: 2026,
    title: "Jalan berlubang di Dago",
    summary: "Warga melaporkan lubang besar di jalan utama Dago.",
    categoryId: "program",
    subcategoryId: "program.infrastruktur",
    provinceCode: "32",
    regencyCode: "32.73",
    reportCount: 1,
  }
  await suDb.insert(issues).values([
    { ...base, number: 1, publicCode: PUBLISHED, publishedAt: new Date() },
    { ...base, number: 2, publicCode: DRAFT, title: "Draf belum terbit" },
    {
      ...base,
      number: 3,
      publicCode: TAKEN,
      title: "Isu yang sudah diturunkan",
      takenDownAt: new Date("2026-10-14T03:00:00Z"),
      takedownReason: "standard_11",
    },
    {
      ...base,
      number: 4,
      publicCode: EDITED,
      publishedAt: new Date(),
      redactedAt: new Date("2026-10-13T03:00:00Z"),
      redactionReason: "standard_3",
    },
  ])
})

afterAll(async () => {
  await resetData(su)
  await su.end()
})

describe("public issue pages", () => {
  test("a published issue is cacheable and sets no cookie", async () => {
    const res = await get(`${ITB}/isu/${PUBLISHED}`)
    expect(res.status).toBe(200)
    expectPublic(res)
    const html = await res.text()
    expect(html).toContain("Jalan berlubang di Dago")
    expect(html).toContain(
      `content="http://itbpub.localhost/isu/${PUBLISHED}/og.png?v=1"`,
    )
    expect(res.headers.get("Content-Security-Policy")).toContain(
      "'strict-dynamic'",
    )
  })

  test("the list is cacheable and hides unpublished issues", async () => {
    const res = await get(`${ITB}/isu`)
    expect(res.status).toBe(200)
    expectPublic(res)
    const html = await res.text()
    expect(html).toContain(PUBLISHED)
    expect(html).not.toContain(DRAFT)
  })

  test("an unpublished issue is 404 and not cached", async () => {
    expectNotFound(await get(`${ITB}/isu/${DRAFT}`))
  })

  test("another tenant's issue is 404", async () => {
    expectNotFound(await get(`${UGM}/isu/${PUBLISHED}`))
  })

  test("pages carry navigation and footer, no masthead", async () => {
    const html = await (await get(`${ITB}/isu`)).text()
    expect(html).not.toContain("Bagaimana mengenalinya?")
    expect(html).toContain('href="/lapor"')
    expect(html).toContain('href="/masuk"')
    expect(html).toContain("Dikelola KM itbpub, organisasi mahasiswa di itbpub")
    const missing = await (await get(`${ITB}/isu/${DRAFT}`)).text()
    expect(missing).toContain("Dikelola KM itbpub")
  })

  test("the list is a card grid with a site title", async () => {
    const html = await (await get(`${ITB}/isu`)).text()
    expect(html).toContain(
      "<title>Jelajahi Isu · Sadar Bersuara · KM itbpub</title>",
    )
    expect(html).toMatch(/<ul class="mt-5 grid[^"]*"><li class="flex"><article/)
    expect(html).toContain('href="/isu?kategori=bencana"')
  })

  test("an empty filtered list offers each action once", async () => {
    const html = await (await get(`${ITB}/isu?q=tidakadaapapun`)).text()
    expect(html).toContain("Belum ada isu yang cocok.")
    expect(html.match(/>Hapus semua saringan</g)).toHaveLength(1)
    expect(html.match(/href="\/lapor"[^>]*>Buat laporan</g)).toHaveLength(1)
  })

  test("a region filter is shown by name", async () => {
    const province = await (await get(`${ITB}/isu?wilayah=32`)).text()
    const page = province.slice(province.indexOf("<main"))
    expect(page).toContain("Jawa Barat")
    expect(page).toContain(PUBLISHED)
    expect(page).toMatch(/href="\/isu"[^>]*>Hapus saringan wilayah</)
    const regency = await (await get(`${ITB}/isu?wilayah=32.73`)).text()
    expect(regency.slice(regency.indexOf("<main"))).toContain("Kota Bandung")
  })

  test("an unknown region drops the filter", async () => {
    const res = await get(`${ITB}/isu?status=responded&wilayah=99`)
    expect(res.status).toBe(301)
    expect(res.headers.get("Location")).toBe("/isu?status=responded")
  })

  test("the issue page follows the PLAN order", async () => {
    const page = await (await get(`${ITB}/isu/${PUBLISHED}`)).text()
    // Head meta repeats the summary
    const html = page.slice(page.indexOf("<main"))
    const order = [
      '<h1 id="issue-title"',
      ">Belum terverifikasi<",
      "Terbit ",
      "Warga melaporkan lubang besar",
      ">Di Halaman Ini<",
      'id="tanggapan-title"',
      'id="status-title"',
      'id="riwayat-title"',
    ].map((text) => html.indexOf(text))
    expect(order.every((at) => at > 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(html).toContain('href="#tanggapan"')
    expect(html.match(/aria-current="step"/g)).toHaveLength(1)
    expect(html).toContain("Belum ada tanggapan resmi.")
    // Root scroll-padding covers the header
    expect(html).not.toContain("scroll-mt-")
    expect(html).toContain(m.issue_advocacy_note())
  })

  test("the issue page links to the complaint form", async () => {
    const page = await (await get(`${ITB}/isu/${PUBLISHED}`)).text()
    expect(page).toMatch(
      new RegExp(
        `href="/isu/${PUBLISHED}/laporkan"[^>]*>${m.issue_complaint_link()}<`,
      ),
    )
    expect(page).not.toContain(m.issue_redacted())
  })

  test("a redacted issue says so with standard and date", async () => {
    const page = await (await get(`${ITB}/isu/${EDITED}`)).text()
    const main = page.slice(page.indexOf("<main"))
    expect(main).toContain(m.issue_redacted())
    expect(main).toMatch(/href="\/pedoman#standar-3"[^>]*>Standar 3</)
    expect(main).toContain("13 Oktober 2026")
  })

  test("a taken-down issue answers 410 with the standard", async () => {
    const res = await get(`${ITB}/isu/${TAKEN}`)
    expect(res.status).toBe(410)
    expect(res.headers.get("Cache-Control")).toBe("no-store")
    const html = await res.text()
    expect(html).toContain(m.issue_taken_down_title())
    expect(html).toContain("14 Oktober 2026")
    expect(html).toContain('href="/pedoman#standar-11"')
    expect(html).not.toContain("Isu yang sudah diturunkan")
    // Other campuses still 404
    expectNotFound(await get(`${UGM}/isu/${TAKEN}`))
  })

  test("a missing issue gets its own 404 page", async () => {
    const res = await get(`${ITB}/isu/${DRAFT}`)
    expectNotFound(res)
    const html = await res.text()
    expect(html).toContain("Isu Tidak Ditemukan")
    expect(html).toContain("<title>Isu Tidak Ditemukan · Sadar Bersuara")
    expect(html).not.toContain("Draf belum terbit")
    // Static import keeps it inline
    expect(html).not.toMatch(/\$RC|<template/)
    const main = html.slice(html.indexOf("<main"), html.indexOf("</main>"))
    expect(main).toMatch(/<a [^>]*href="\/isu"[^>]*>Jelajahi Isu<\/a>/)
  })

  test("an unknown path is 404 inside the tenant shell", async () => {
    const res = await get(`${ITB}/tidak-ada`)
    expectNotFound(res)
    const html = await res.text()
    expect(html).toContain("Halaman Tidak Ditemukan")
    expect(html).toMatch(/<a [^>]*href="\/"[^>]*>Ke beranda<\/a>/)
    // Inline body, renderHtml covers size
    expect(html).not.toMatch(/\$RC|<template/)
    expect(html).toContain("<footer")
    expect(html).toContain("Dikelola KM itbpub, organisasi mahasiswa di itbpub")
    expect(html).toContain('href="/lapor"')
    const other = await (await get(`${UGM}/tidak-ada`)).text()
    expect(other).toContain(
      "Dikelola KM ugmpub, organisasi mahasiswa di ugmpub",
    )
  })

  test("a /kelola 403 keeps the tenant shell", async () => {
    const res = await get(`${ITB}/kelola`)
    expect(res.status).toBe(403)
    const html = await res.text()
    expect(html).toContain(
      "<title>Akses Ditolak · Sadar Bersuara · KM itbpub</title>",
    )
    expect(html).toContain("<footer")
    expect(html).toContain("Dikelola KM itbpub, organisasi mahasiswa di itbpub")
    expect(html).not.toMatch(/\$RC|<template/)
    const page = html.slice(html.indexOf("Akses Ditolak</h1>"))
    expect(page.slice(0, page.indexOf("</main>"))).toMatch(
      /href="\/masuk"[^>]*>Masuk</,
    )
  })

  test("a forged or cross-sort cursor redirects to page 1", async () => {
    const forged = (sort: string, key: string) =>
      Buffer.from(JSON.stringify([2, sort, key, crypto.randomUUID()])).toString(
        "base64url",
      )
    const cases: [string, string][] = [
      [`?kursor=${forged("laporan", "5")}`, "/isu"],
      [`?kursor=${forged("laporan", "abc")}&urut=laporan`, "/isu?urut=laporan"],
      [`?kursor=${forged("terbaru", "5")}`, "/isu"],
    ]
    for (const [search, location] of cases) {
      const res = await get(`${ITB}/isu${search}`)
      expect([res.status, res.headers.get("Location")]).toEqual([301, location])
    }
  })

  test("a single page of results has no paging landmark", async () => {
    const html = await (await get(`${ITB}/isu`)).text()
    expect(html).not.toContain('aria-label="Halaman hasil"')
    expect(html.match(/<nav(?![^>]*aria-label)/g)).toBeNull()
  })

  test("a second page gets a named paging landmark", async () => {
    const [first] = await suDb
      .select({ orgId: issues.orgId })
      .from(issues)
      .limit(1)
    const orgId = first?.orgId ?? ""
    const extra = Array.from({ length: 20 }, (_, i) => ({
      orgId,
      year: 2026,
      number: 100 + i,
      publicCode: `ISU-ITBPUB-26-${100 + i}`,
      title: "Isu lama untuk halaman",
      summary: "Isu lama untuk menguji halaman kedua.",
      categoryId: "program",
      subcategoryId: "program.infrastruktur",
      provinceCode: "32",
      regencyCode: "32.73",
      reportCount: 1,
      publishedAt: new Date(Date.UTC(2026, 0, 1, 0, i)),
    }))
    await suDb.insert(issues).values(extra)
    try {
      const html = await (await get(`${ITB}/isu`)).text()
      expect(html).toContain('<nav aria-label="Halaman hasil"')
    } finally {
      await su.query("DELETE FROM issues WHERE number >= 100")
    }
  })

  test("an unknown query parameter redirects to the canonical URL", async () => {
    const res = await get(`${ITB}/isu/${PUBLISHED}?fbclid=abc`)
    expect(res.status).toBe(301)
    expect(res.headers.get("Location")).toBe(`/isu/${PUBLISHED}`)
  })
})

describe("home", () => {
  const showcase = async (
    status: "responded" | "confirmed_resolved" | "awaiting_response",
    number: number,
    published = true,
  ) => {
    const [first] = await suDb
      .select({ orgId: issues.orgId })
      .from(issues)
      .limit(1)
    await suDb.insert(issues).values({
      orgId: first?.orgId ?? "",
      year: 2026,
      number,
      publicCode: `ISU-ITBPUB-26-${number}`,
      title: `Isu beranda ${status}`,
      summary: "Isu untuk menguji daftar beranda.",
      categoryId: "program",
      subcategoryId: "program.infrastruktur",
      provinceCode: "32",
      regencyCode: "32.73",
      reportCount: 3,
      govStatus: status,
      publishedAt: published ? new Date() : null,
      lastActivityAt: new Date(Date.UTC(2026, 9, 5)),
    })
  }

  test("is cacheable and shows an honest empty list", async () => {
    const res = await get(`${ITB}/`)
    expect(res.status).toBe(200)
    expectPublic(res)
    const html = await res.text()
    expect(html).toContain(`href="/isu/${PUBLISHED}"`)
    // UGM has nothing published
    expect(await (await get(`${UGM}/`)).text()).toContain(
      "Belum ada isu yang terbit.",
    )
    expect(html).not.toContain("Baru Ditanggapi Instansi")
    expect(html).not.toContain("Selesai Terkonfirmasi")
    expect(html).not.toContain("/km-itb/")
  })

  test("ends with one next step, never on an empty list", async () => {
    const closing = /<a [^>]*href="\/isu"[^>]*>Jelajahi Isu<\/a>/
    const main = (html: string) =>
      html.slice(html.indexOf("<main"), html.indexOf("</main>"))
    // Empty list: one closing button
    expect(main(await (await get(`${UGM}/`)).text())).toMatch(closing)
    // Its own link closes it
    const html = main(await (await get(`${ITB}/`)).text())
    expect(html).not.toMatch(closing)
    expect(html).toMatch(/href="\/isu"[^>]*>Lihat semua isu</)
  })

  test("latest published issues, any status, own tenant", async () => {
    await showcase("responded", 300)
    await showcase("confirmed_resolved", 301)
    await showcase("awaiting_response", 302)
    await showcase("responded", 303, false)
    try {
      const html = await (await get(`${ITB}/`)).text()
      const list = html.slice(
        html.indexOf('id="isu-terbaru"'),
        html.indexOf("</main>"),
      )
      for (const number of [300, 301, 302]) {
        expect(list).toContain(`href="/isu/ISU-ITBPUB-26-${number}"`)
      }
      expect(html).not.toContain("ISU-ITBPUB-26-303")
      expect(list).toContain(">Selesai terkonfirmasi<")
      expect(html).toContain("Kota Bandung · 3 laporan")
      const other = await (await get(`${UGM}/`)).text()
      expect(other).not.toContain("ISU-ITBPUB-26-30")
      expect(other).toContain("Belum ada isu yang terbit.")
    } finally {
      await su.query("DELETE FROM issues WHERE number >= 300")
    }
  })

  test("search works without JS and states no totals", async () => {
    const html = await (await get(`${ITB}/`)).text()
    const form = html.match(/<form role="search"[^>]*>/)?.[0] ?? ""
    expect(form).toContain('action="/isu"')
    expect(form).toContain('method="get"')
    expect(html).toContain('name="q"')
    expect(html).not.toContain("minLength")
    expect(html).toContain("Laporkan Masalah Publik.</span> <br/><span")
    expect(html).toContain('href="/masuk?daftar=1"')
    expect(html).not.toMatch(/laporan masuk|isu aktif|Pantauan/)
  })
})

describe("KM ITB tenant assets", () => {
  test("only the KM ITB set gets its logo and star", async () => {
    const home = await (await get(`${KM}/`)).text()
    // Header and footer logo
    expect(home.match(/src="\/km-itb\/logo-km.webp"/g)).toHaveLength(2)
    expect(home).not.toContain('src="/logo.svg"')
    expect(home.match(/navlink-star/g)).toHaveLength(1)
    // 3x file in header, footer
    expect(home.match(/srcSet="[^"]*logo-km-168.webp 3x"/g)).toHaveLength(2)
    // Home ornaments follow root
    expect(home).toContain('src="/km-itb/rings-45.svg"')
    const list = await (await get(`${KM}/isu`)).text()
    expect(list).toMatch(
      /href="\/isu"[^>]*>(?:(?!<\/a>).)*\/km-itb\/navlink-star.webp/,
    )
    const forbidden = await (await get(`${KM}/kelola`)).text()
    expect(forbidden).toContain('src="/km-itb/logo-km.webp"')
  })

  test("other tenants reference no KM ITB file", async () => {
    const paths = [
      "/",
      "/isu",
      `/isu/${PUBLISHED}`,
      "/tidak-ada",
      "/kelola",
      "/tentang",
      "/privasi",
      "/pedoman",
      "/data",
    ]
    for (const host of [ITB, UGM]) {
      for (const path of paths) {
        const html = await (await get(`${host}${path}`)).text()
        expect(html).toContain("<footer")
        expect(html).not.toContain("/km-itb/")
      }
    }
  })

  test("About wears the home look, KM ornaments only", async () => {
    const html = await (await get(`${KM}/tentang`)).text()
    expect(html).not.toContain("/km-itb/about/")
    expect(html).toContain("/km-itb/rings-45.svg")
    expect(html).toContain('<div class="relative mt-8 bg-band">')
    expect(html).toMatch(
      /<h2[^>]*id="prinsip"[^>]*><span class="highlight-box bg-highlight text-ink">/,
    )
    expect(html).toContain("bg-home-list")
    // Same header as /lapor
    expect(html).toMatch(
      /header-bg[\s\S]*<h1 class="mt-2 font-bold font-heading/,
    )
  })
})

describe("content pages", () => {
  test("are cacheable and linked from every footer", async () => {
    for (const path of ["/tentang", "/privasi", "/pedoman"]) {
      const res = await get(`${ITB}${path}`)
      expect(res.status).toBe(200)
      expectPublic(res)
    }
    const page = await (await get(`${ITB}/isu`)).text()
    const footer = page.slice(page.indexOf("<footer"))
    expect(footer).toMatch(/<nav aria-label="Kebijakan">/)
    expect(footer).toContain('href="/privasi"')
    expect(footer).toContain('href="/pedoman"')
  })

  test("the issue privacy box links the policy", async () => {
    const html = await (await get(`${ITB}/isu/${PUBLISHED}`)).text()
    const main = html.slice(0, html.indexOf("<footer"))
    expect(main).toMatch(
      /cukup laporan\.(?:<!-- -->)? <a[^>]*href="\/privasi"[^>]*>Kebijakan privasi<\/a>/,
    )
  })

  test("About states purpose, operator and one next step", async () => {
    const html = await (await get(`${ITB}/tentang`)).text()
    const main = html.slice(
      html.indexOf('id="konten"'),
      html.indexOf("<footer"),
    )
    // Menu label visible in H1
    const h1 = main.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? ""
    expect(h1).not.toContain("sr-only")
    expect(h1.replace(/<[^>]+>/g, "")).toBe("Tentang Sadar Bersuara")
    // Operator lives in the footer
    expect(main).not.toContain("mengelola Sadar Bersuara secara mandiri")
    expect(main).toContain("Pantau di halaman Laporan saya")
    // Same k as merge
    expect(main).toContain("minimal 5 laporan di kecamatan itu")
    // Detail never links to summary
    expect(main).not.toContain('href="/#cara-kerja"')
    // No H2 to H4 skip
    expect(main).toMatch(/<h3[^>]*>Tampil ke Publik<\/h3>/)
    // Links in sentence case
    expect(main).toMatch(/href="\/privasi#publik"[^>]*>Kebijakan privasi</)
    expect(main).toMatch(/href="\/pedoman"[^>]*>Pedoman konten</)
    // No Fase 2 claims
    for (const absent of ["Skor", "dukungan", "Kredit:", "rate limiting"]) {
      expect(main).not.toContain(absent)
    }
    const links = main.match(/<a [^>]*href="([^"]+)"/g) ?? []
    expect(links.at(-1)).toContain('href="/lapor"')
    expect(main.match(/>Buat laporan</g)).toHaveLength(1)
  })

  test("About Metode summarises, the guidelines hold the checklist", async () => {
    const html = await (await get(`${ITB}/tentang`)).text()
    const main = html.slice(
      html.indexOf('id="konten"'),
      html.indexOf("<footer"),
    )
    expect(main).toContain('href="/pedoman#pemeriksaan"')
    expect(main).not.toContain("Judul dan ringkasan tidak memuat data pribadi")
    expect(main).not.toContain("sebelum digabung")
    expect(main).toContain("Isi laporan asli Anda")
    const guide = await (await get(`${ITB}/pedoman`)).text()
    expect(guide).toContain('id="pemeriksaan"')
  })

  test("the credit line shows only where the org has one", async () => {
    const html = await (await get(`${KM}/tentang`)).text()
    expect(html).toContain("Kredit: CSTS, KM ITB")
  })

  test("Privacy publishes the decided retention periods", async () => {
    const html = await (await get(`${ITB}/privasi`)).text()
    for (const period of [
      "90 hari setelah ditolak",
      "Sekitar 2 sampai 3 minggu",
      "3 bulan",
    ]) {
      expect(html).toContain(period)
    }
    expect(html).toContain("18 tahun atau lebih")
    expect(html).toContain("minimal 5 laporan")
    // No email: operator fallback
    expect(html).toContain("Hubungi pengurus KM itbpub.")
    const km = await (await get(`${KM}/privasi`)).text()
    expect(km).toContain('href="mailto:kontak@km.contoh.id"')
  })

  test("Privacy claims no purge, closure or status email not built", async () => {
    const html = await (await get(`${ITB}/privasi`)).text()
    // Purge job runs, no caveat
    expect(QUEUES.some((queue) => queue.name === "maintenance-daily")).toBe(
      true,
    )
    expect(html).not.toContain("belum berjalan")
    // Brevo sends more than codes
    expect(html).toContain("kabar perubahan status laporan")
    expect(html).toMatch(/<th[^>]*>Masa Simpan<\/th>/)
    expect(html).toMatch(
      /<caption[^>]*><span class="sr-only">Masa Simpan per Jenis Data<\/span>/,
    )
    for (const unbuilt of [
      "menutup akun",
      "disunting moderator",
      "termasuk kode verifikasi",
    ]) {
      expect(html).not.toContain(unbuilt)
    }
  })

  test("public evidence copy matches the publish job", async () => {
    // Copy needs the publish job
    const publish = QUEUES.some((queue) => queue.name === "evidence-publish")
    expect(publish).toBe(true)
    for (const path of ["/tentang", "/privasi"]) {
      const html = await (await get(`${ITB}${path}`)).text()
      expect([path, html.includes("disetujui admin")]).toEqual([path, true])
    }
  })

  test("Guidelines number every standard for citing", async () => {
    const html = await (await get(`${ITB}/pedoman`)).text()
    for (let n = 1; n <= 13; n++) expect(html).toContain(`id="standar-${n}"`)
    expect(html).not.toContain('id="standar-14"')
    // Numbers are text, 4.5:1
    const list = html.match(/<ol class="([^"]*)"[^>]*><li[^>]*id="standar-1"/)
    expect(list?.[1]).toContain("marker:text-accent")
    expect(list?.[1]).not.toContain("marker:text-brand")
    expect(html).toContain("Judul dan ringkasan tidak memuat data pribadi")
    expect(html).toContain("Status laporan Anda di halaman Laporan saya")
    expect(html.match(/Hubungi pengurus/g)).toHaveLength(1)
  })
})

describe("OG image", () => {
  test("an old or missing version redirects without caching", async () => {
    const res = await get(`${ITB}/isu/${PUBLISHED}/og.png?v=7`)
    expect(res.status).toBe(301)
    expect(res.headers.get("Location")).toBe(`/isu/${PUBLISHED}/og.png?v=1`)
    expect(res.headers.get("Cache-Control")).toBe("no-store")
    expect(res.headers.get("Cloudflare-CDN-Cache-Control")).toBeNull()
  })

  test("the current version renders an immutable PNG", async () => {
    const res = await get(`${ITB}/isu/${PUBLISHED}/og.png?v=1`)
    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Type")).toBe("image/png")
    expect(res.headers.get("Cloudflare-CDN-Cache-Control")).toBe(
      "max-age=31536000, immutable",
    )
    expect(res.headers.get("Set-Cookie")).toBeNull()
    const bytes = new Uint8Array(await res.arrayBuffer())
    expect([...bytes.slice(1, 4)]).toEqual([80, 78, 71])
  })

  test("junk beside the version redirects, even past the edge", async () => {
    for (const search of ["?v=1&index=r1", "?index=r2&v=1", "?v=1&_routes=x"]) {
      const res = await handler(
        new Request(`${ITB}/isu/${PUBLISHED}/og.png${search}`),
      )
      expect([search, res.status, res.headers.get("Location")]).toEqual([
        search,
        301,
        `/isu/${PUBLISHED}/og.png?v=1`,
      ])
    }
  })

  test("an unpublished issue has no card", async () => {
    expectNotFound(await get(`${ITB}/isu/${DRAFT}/og.png?v=1`))
  })
})

// Worker output shape, small-n applied
function snapshot(): DashboardSnapshot {
  const zeroStatuses = {
    awaiting_response: 12,
    responded: 6,
    in_progress: 0,
    claimed_resolved: 2,
    confirmed_resolved: 5,
    reopened: 3,
    not_competent: 0,
    not_followed_up: 0,
    closed: 0,
  }
  return {
    v: 6,
    firstReportAt: "2026-03-02",
    reports: {
      total: 64,
      decided: 50,
      verified: 40,
      verifiedShare: 0.8,
      queue: 9,
    },
    issues: { published: 26, mergedReports: 40, reportsPerIssue: 1.5 },
    verifyTime: { n: 40, medianHours: 20, p90Hours: 70 },
    resolution: {
      pending: 2,
      confirmed: 5,
      reopened: 3,
      claimTotal: 10,
      checked: 8,
      confirmedShare: 0.625,
    },
    trend: [
      { month: "2025-11", received: 0, verified: 0 },
      { month: "2025-12", received: 0, verified: 0 },
      { month: "2026-01", received: 0, verified: 0 },
      { month: "2026-02", received: 0, verified: 0 },
      // Months exact, sum to total
      { month: "2026-03", received: 3, verified: 0 },
      { month: "2026-04", received: 6, verified: 2 },
      { month: "2026-05", received: 7, verified: 5 },
      { month: "2026-06", received: 8, verified: 6 },
      { month: "2026-07", received: 9, verified: 7 },
      { month: "2026-08", received: 10, verified: 7 },
      { month: "2026-09", received: 11, verified: 8 },
      { month: "2026-10", received: 10, verified: 5 },
    ],
    trendTotal: 64,
    categories: { program: 20, bencana: 6, bansos: 0 },
    statuses: zeroStatuses,
    verifiedProvinces: {
      "all|all": { "32": 22, "34": null },
      "program|all": { "32": 18, "34": null },
      "bencana|all": { "32": 6 },
    },
    verifiedProvinceTotals: {
      "all|all": 26,
      "program|all": 20,
      "bencana|all": 6,
    },
    response: {
      days: 14,
      due: 8,
      responded: 5,
      share: 0.625,
      firstResponse: { n: 6, medianDays: 6, p90Days: 12.5 },
      waiting: { d0_7: 1, d8_14: 0, d15_30: 2, d31_90: 0, d91: 0 },
      overdue: [{ agency: "BPBD Kota Bandung", overdue: 1, referred: 2 }],
      clearAgencies: 1,
      unreferred: 2,
    },
    reasons: {
      rejected: {
        standard_1: 0,
        standard_2: 6,
        standard_3: null,
        standard_4: 0,
        standard_5: 0,
        standard_6: 0,
        standard_7: 0,
        standard_8: 0,
        standard_9: 0,
        standard_10: 0,
        standard_11: 0,
        standard_12: 0,
        standard_13: 0,
        out_of_scope: 5,
      },
      unverifiable: {
        no_evidence: 7,
        source_unreachable: 0,
        conflicting_information: 0,
        location_unclear: null,
      },
    },
  }
}

// Worker writes every filter key
function fullSnapshot(): DashboardSnapshot {
  const base = snapshot()
  for (const category of CATEGORY_FILTERS) {
    for (const status of STATUS_FILTERS) {
      const key = filterKey(category, status)
      base.verifiedProvinces[key] ??= {}
      base.verifiedProvinceTotals[key] ??= 0
    }
  }
  return base
}

describe("dashboard", () => {
  test("without a snapshot it says so and ends with one step", async () => {
    const res = await get(`${UGM}/data`)
    expectPublic(res)
    const html = await res.text()
    expect(html).toMatch(/<h1[^>]*>Dashboard<\/h1>/)
    expect(html).toContain(m.data_empty_title())
    expect(html).not.toContain(m.data_key_title())
    expect(html).not.toContain(m.data_ranking_title())
    expect(html).toMatch(/href="\/isu"[^>]*>Jelajahi Isu</)
  })

  test("shows the stored snapshot with n, period and freshness", async () => {
    const { rows } = await su.query<{ id: string }>(
      "SELECT id FROM organizations WHERE slug = 'itbpub'",
    )
    await su.query(
      "INSERT INTO dashboard_snapshots (org_id, data, computed_at) VALUES ($1, $2, now() - interval '5 minutes')",
      [rows[0]?.id, JSON.stringify(fullSnapshot())],
    )
    const res = await get(`${ITB}/data`)
    expectPublic(res)
    const html = await res.text()
    // Freshness stated once
    expect(html.split("Terakhir diperbarui")).toHaveLength(2)
    expect(html.split("Pembaruan berikutnya")).toHaveLength(2)
    expect(html).not.toContain("Pembaruan angka tertunda")
    // Note, counts, then quality
    const low = html.indexOf("Baru 64 laporan")
    const key = html.indexOf('id="angka-utama"')
    expect(low).toBeGreaterThan(0)
    expect(key).toBeGreaterThan(low)
    expect(html.indexOf(m.data_resolution_label())).toBeGreaterThan(key)
    expect(html.indexOf(m.data_moderation_title())).toBeGreaterThan(key)
    // Under 100 reports
    expect(html).toContain("Baru 64 laporan sejak 2 Maret 2026")
    expect(html).toContain("62,5")
    expect(html).toContain("dari 8 klaim yang sudah dicek")
    expect(html).toContain("Dari 10 isu yang diklaim selesai")
    // Exact parts beside the share
    expect(html).toMatch(/Masih menunggu konfirmasi<\/dt><dd[^>]*>2<\/dd>/)
    expect(html).toMatch(/<h3[^>]*>Klaim Selesai yang Terkonfirmasi<\/h3>/)
    // Failed claims shown, exact
    expect(html).toMatch(/<dt>Dibuka kembali<\/dt><dd[^>]*>3<\/dd>/)
    // Small months shown exactly
    expect(html).toMatch(/>Maret 2026<\/th><td[^>]*>3</)
    expect(html).toContain("80% dari 50 laporan yang sudah diperiksa")
    expect(html).toContain("20 jam")
    // PLAN §5.8 response metrics
    expect(html).toMatch(/<h2[^>]*id="tanggapan-instansi"[^>]*>/)
    expect(html).toContain("62,5")
    expect(html).toContain(
      "5 dari 8 isu yang diteruskan lebih dari 14 hari lalu",
    )
    expect(html).toContain("6 hari")
    expect(html).toContain("12,5 hari")
    expect(html).toMatch(/>15–30 hari<\/th><td[^>]*>2</)
    expect(html).toMatch(/>Belum diteruskan ke instansi<\/th><td[^>]*>2</)
    expect(html).toMatch(/>BPBD Kota Bandung<\/th><td[^>]*>1<\/td><td[^>]*>2</)
    // Zero-overdue agencies as one line
    expect(html).toContain("1 instansi lain yang menerima isu")
    expect(html).toMatch(/<h3[^>]*>Isu Lewat Tenggat per Instansi<\/h3>/)
    expect(html).toMatch(
      /<a [^>]*href="\/isu\?status=awaiting_response"[^>]*>Lihat isu yang belum ditanggapi<\/a>/,
    )
    // PLAN §5.10 counts per reason
    expect(html).toMatch(
      />Standar 2: Duplikat dari laporan lain<\/th><td[^>]*>6</,
    )
    // Under moderation, title before lead
    const reasons = html.indexOf(m.data_reasons_caption())
    expect(reasons).toBeLessThan(html.indexOf('id="tanggapan-instansi"'))
    expect(reasons).toBeLessThan(html.indexOf(m.data_reasons_lead()))
    expect(html).toMatch(/>Standar 3: [^<]+<\/th><td[^>]*>1–4</)
    expect(html).not.toMatch(/>Standar 1: /)
    // Only the capita map left
    const pending = html.match(
      new RegExp(`>${m.data_pending_title()}</h3><ul[^>]*>([\\s\\S]*?)</ul>`),
    )?.[1]
    expect(pending).toContain(m.data_pending_capita())
    // PLAN §5.9 drill-down, deferred
    expect(pending).toContain(m.data_pending_regency())
    expect(pending).not.toContain("tanggapan")
    // Every province links its issues
    expect(html.match(/<a href="\/isu\?wilayah=\d\d"/g)).toHaveLength(38)
    // Geometry from the cached sprite
    expect(html).toMatch(/<use href="[^"]*provinces[^"]*\.svg#p-34"/)
    expect(html).not.toMatch(/ d="M\d+,\d+L/)
    expect(html).toContain(m.data_region_search())
    // Explicit apply button
    expect(html).not.toContain("<noscript><button")
    expect(html).toMatch(/<button type="submit"[^>]*>Terapkan<\/button>/)
    expect(html).not.toContain('name="tampilan" value="peta"')
    expect(html).toContain(m.data_top_title())
    expect(html).toMatch(/<h2[^>]*id="grafik"[^>]*>/)
    // Fixed label, chart named hidden
    expect(html).toMatch(
      /aria-pressed="false"[^>]*>(?:<svg[\s\S]*?<\/svg>)?Tabel<span class="sr-only"> [^<]+<\/span><\/button>/,
    )
    expect(html).not.toMatch(
      /<a href="\/isu\?wilayah=[^"]*" class="[^"]*outline-none/,
    )
    // Verified reports, 1–4 hidden
    expect(html).toContain("Jawa Barat: 22 laporan terverifikasi")
    expect(html).toContain(
      "Daerah Istimewa Yogyakarta: 1–4 laporan terverifikasi",
    )
    expect(html).toContain("Aceh: 0 laporan terverifikasi")
    // Layer switch, Laporan first
    expect(html).toMatch(
      /<a aria-current="true"[^>]*href="\/data#peta-isu"[^>]*>(?:<svg[\s\S]*?<\/svg>)?Laporan<\/a>/,
    )
    expect(html).toMatch(
      /<a class="[^"]*" href="\/data\?lapisan=tuntutan#peta-isu"[^>]*>Tuntutan<\/a>/,
    )
    expect(html).toContain("OpenStreetMap contributors")
    expect(html).toContain("Open Database License (ODbL)")
    // No-JS twin of every chart
    for (const caption of [
      m.data_trend_caption(),
      m.data_category_caption(),
      m.data_status_caption(),
    ]) {
      expect(html).toMatch(
        new RegExp(
          `class="hidden noscript:block"><section[^>]*><table[^>]*><caption[^>]*>${caption}<`,
        ),
      )
    }
    expect(html).not.toContain("recharts")
  })

  test("province cells read exact in the table", async () => {
    const html = await (
      await get(`${ITB}/data?kategori=program&tampilan=tabel`)
    ).text()
    expect(html).not.toContain("<svg viewBox")
    expect(html).toContain(m.data_province_caption())
    // Value, then the three categories
    expect(html).toMatch(
      />Daerah Istimewa Yogyakarta<\/a><\/th>(?:<td[^>]*>[^<]*<\/td>){4}/,
    )
    const cells = html
      .split(">Daerah Istimewa Yogyakarta</a></th>")[1]
      ?.match(/<td[^>]*>([^<]*)<\/td>/g)
      ?.slice(0, 4)
      .map((cell) => cell.replace(/<[^>]+>/g, ""))
    expect(cells).toEqual(["1–4", "1–4", "0", "0"])
    expect(html).toContain('aria-current="true"')
  })

  test("ranks published issues as links, tabs in the URL", async () => {
    const html = await (await get(`${ITB}/data`)).text()
    const ranking = html.split('id="peringkat-isu"')[1] ?? ""
    expect(ranking).toContain(m.data_ranking_title())
    expect(ranking).toMatch(
      /<a [^>]*aria-current="true"[^>]*>Laporan Terbanyak<\/a>/,
    )
    expect(ranking).toMatch(
      /<a [^>]*href="\/data\?peringkat=terlama#peringkat-isu"[^>]*>Terlama Belum Selesai<\/a>/,
    )
    expect(ranking).toContain(`href="/isu/${PUBLISHED}"`)
    expect(ranking).not.toContain(DRAFT)
    expect(ranking).toMatch(/>1<\/span>[\s\S]*>laporan</)
    // Ranking before the data notes
    expect(html.indexOf('id="peringkat-isu"')).toBeLessThan(
      html.indexOf('id="tentang-data"'),
    )
    // No banned tabs
    expect(ranking).not.toMatch(/kepuasan|didukung|terdampak|mendesak/i)
    const oldest = await (
      await get(`${ITB}/data?peringkat=terlama&tampilan=tabel`)
    ).text()
    const tab = oldest.split('id="peringkat-isu"')[1] ?? ""
    expect(tab).toMatch(
      /<a [^>]*aria-current="true"[^>]*>Terlama Belum Selesai<\/a>/,
    )
    expect(tab).toContain(`href="/isu/${PUBLISHED}"`)
    expect(tab).toContain(m.data_ranking_unit_days())
    // Map links keep the tab
    expect(oldest).toContain('href="/data?peringkat=terlama#peta-isu"')
    expect(oldest).toContain(
      'href="/data?kategori=program&amp;peringkat=terlama&amp;tampilan=tabel#peta-isu"',
    )
  })

  test("filters keep the URL canonical", async () => {
    const res = await get(`${ITB}/data?tampilan=peta&kategori=semua&utm_x=1`)
    expect(res.status).toBe(301)
    expect(res.headers.get("Location")).toBe("/data")
  })

  test("a stale snapshot says when it was computed", async () => {
    await su.query(
      "UPDATE dashboard_snapshots SET computed_at = now() - interval '3 hours'",
    )
    const html = await (await get(`${ITB}/data`)).text()
    expect(html).toContain("Pembaruan angka tertunda")
    expect(html).not.toContain("Pembaruan berikutnya sekitar")
  })
})

describe("tuntutan on the dashboard, home and apex", () => {
  const FIELDS: DemandFields = {
    scope: "regional",
    provinceCode: "32",
    regencyCode: null,
    category: "infrastruktur_transportasi",
    title: "Standar layanan air bersih di Jawa Barat",
    body: "Kami menuntut standar waktu pemulihan suplai air bersih saat gangguan.",
    summary: "Waktu pemulihan suplai air dan kewajiban tangki air bantuan.",
    target: "Pemerintah Provinsi Jawa Barat",
    raisedOn: "2026-07-30",
  }
  const NATIONAL_TITLE = "Transparansi data penerima bantuan sosial nasional"
  const DRAFT_TITLE = "Tuntutan draf yang belum terbit"
  let tenant: DemandTenant
  let admin = ""
  const codes: string[] = []

  async function make(fields: DemandFields, publish = true) {
    const created = await createDemand(tenant, {
      fields,
      items: ["Standar waktu pemulihan", "Tangki air bantuan"],
      actorId: admin,
    })
    if (!created.ok) throw new Error(created.reason)
    if (publish) {
      const demand = await getManagedDemand(tenant.id, created.code)
      await changeDemandState(tenant, {
        code: created.code,
        action: "publish",
        version: demand?.version ?? 0,
        note: null,
        actorId: admin,
      })
    }
    codes.push(created.code)
    return created.code
  }

  beforeAll(async () => {
    const { rows } = await su.query<{ id: string }>(
      "SELECT id FROM organizations WHERE slug = 'itbpub'",
    )
    tenant = {
      id: rows[0]?.id ?? "",
      host: "itbpub.localhost",
      campusCode: "ITBPUB",
    }
    admin = await insertUser(su, "admin.tuntutan@contoh.id")
    const first = await make(FIELDS)
    await make({ ...FIELDS, title: "Halte bus layak di seluruh Jawa Barat" })
    await make({
      ...FIELDS,
      scope: "national",
      provinceCode: null,
      title: NATIONAL_TITLE,
      target: "Kementerian Sosial",
    })
    await make({ ...FIELDS, title: DRAFT_TITLE }, false)
    const item = (await getManagedDemand(tenant.id, first))?.items[0]
    if (!item) throw new Error("item")
    await recordItemUpdate(tenant, {
      code: first,
      itemId: item.id,
      version: item.version,
      to: { response: "responded", fulfilment: "fulfilled" },
      occurredOn: "2026-10-01",
      note: "Pemerintah provinsi menerbitkan standar layanan air bersih.",
      sourceText: "Surat edaran gubernur",
      sourceUrl: null,
      actorId: admin,
    })
  })

  afterAll(async () => {
    await su.query("DELETE FROM demands")
  })

  test("an issue names the public tuntutan that cite it", async () => {
    for (const code of [codes[0] ?? "", codes[3] ?? ""]) {
      const linked = await linkIssue(tenant, {
        code,
        issueCode: PUBLISHED,
        actorId: admin,
      })
      expect(linked.ok).toBe(true)
    }
    const html = await (await get(`${ITB}/isu/${PUBLISHED}`)).text()
    const block = html.slice(html.indexOf('id="issue-demands"'))
    expect(block).toContain(m.issue_demands_title())
    expect(block).toContain(`href="/tuntutan/${codes[0]}"`)
    expect(block).toContain("1 dari 2 subtuntutan dipenuhi")
    expect(html).not.toContain(DRAFT_TITLE)
    const other = await (await get(`${ITB}/isu/${EDITED}`)).text()
    expect(other).not.toContain('id="issue-demands"')
  })

  test("a map link to a province without tuntutan keeps its filter", async () => {
    await su.query(
      "INSERT INTO regions (code, parent_code, level, name) VALUES ('11', NULL, 1, 'Aceh') ON CONFLICT DO NOTHING",
    )
    try {
      const html = await (await get(`${ITB}/tuntutan?provinsi=11`)).text()
      expect(html).toContain('<option value="11" selected="">Aceh</option>')
      expect(html).toContain(m.demands_empty_province({ province: "Aceh" }))
      const all = await (await get(`${ITB}/tuntutan`)).text()
      expect(all).not.toContain('<option value="11"')
    } finally {
      // Global table, seed test counts
      await su.query("DELETE FROM regions WHERE code = '11'")
    }
  })

  test("/data counts them in Angka Utama and lists the latest", async () => {
    const html = await (await get(`${ITB}/data`)).text()
    const key = html.slice(
      html.indexOf('id="angka-utama"'),
      html.indexOf("</section>", html.indexOf('id="angka-utama"')),
    )
    for (const [label, value] of [
      [m.data_key_demands(), "3"],
      [m.data_key_demands_active(), "3"],
      [m.data_key_demands_fulfilled(), "0"],
      [m.data_key_items_fulfilled(), "1"],
    ]) {
      expect(key).toMatch(
        new RegExp(
          `>${label}<span[^>]*>[^<]*</span></dt><dd[^>]*>${value}</dd>`,
        ),
      )
    }
    expect(key).toContain("1 nasional, 2 daerah")
    const section = html.slice(html.indexOf('id="tuntutan-publik"'))
    expect(section).toContain(m.data_demands_title())
    expect(section).toContain(`href="/tuntutan/${codes[2]}"`)
    expect(section).toContain(NATIONAL_TITLE)
    expect(section).toContain("Sebagian dipenuhi")
    expect(section).toMatch(/href="\/tuntutan"[^>]*>Lihat semua tuntutan</)
    expect(html).not.toContain(DRAFT_TITLE)
    // After agency answers, before map
    expect(html.indexOf('id="tuntutan-publik"')).toBeGreaterThan(
      html.indexOf('id="tanggapan-instansi"'),
    )
    expect(html.indexOf('id="tuntutan-publik"')).toBeLessThan(
      html.indexOf('id="peta-isu"'),
    )
  })

  test("the Tuntutan layer colours provinces by tuntutan daerah", async () => {
    const html = await (await get(`${ITB}/data?lapisan=tuntutan`)).text()
    expect(html).toMatch(
      /<a aria-current="true"[^>]*href="\/data\?lapisan=tuntutan#peta-isu"/,
    )
    expect(html.match(/<a href="\/tuntutan\?provinsi=\d\d"/g)).toHaveLength(38)
    expect(html).not.toMatch(/<a href="\/isu\?wilayah=/)
    expect(html).toContain("Jawa Barat: 2 tuntutan daerah")
    expect(html).toContain("Aceh: 0 tuntutan daerah")
    // Jawa Barat two: step low
    expect(html).toMatch(
      /<a href="\/tuntutan\?provinsi=32"[^>]*><title>[^<]*<\/title><use [^>]*fill="#8a6bd8"/,
    )
    // Exact counts, no hidden class
    const legend = html.slice(html.indexOf(m.data_demand_legend_title()))
    expect(legend.slice(0, 600)).not.toContain("1–4")
    expect(legend.slice(0, 600)).not.toContain(m.data_class_none())
    // No report filters here
    expect(html).not.toContain('href="/data?kategori=')
    expect(html).not.toContain(">Terapkan</button>")
    // National beside the map
    const aside = html.slice(html.indexOf('id="tuntutan-nasional"'))
    expect(aside).toContain(NATIONAL_TITLE)
    expect(aside).toContain(`href="/tuntutan/${codes[2]}"`)
    expect(aside).toContain('href="/tuntutan?lingkup=nasional"')
  })

  test("its table reads exact counts per fulfilment status", async () => {
    const html = await (
      await get(`${ITB}/data?lapisan=tuntutan&tampilan=tabel`)
    ).text()
    expect(html).not.toContain("<svg viewBox")
    expect(html).toContain(m.data_demand_province_caption())
    const cells = html
      .split(">Jawa Barat</a></th>")[1]
      ?.match(/<td[^>]*>([^<]*)<\/td>/g)
      ?.slice(0, 5)
      .map((cell) => cell.replace(/<[^>]+>/g, ""))
    // Total, then the four statuses
    expect(cells).toEqual(["2", "1", "1", "0", "0"])
  })

  test("home shows the latest before the issue lists", async () => {
    const html = await (await get(`${ITB}/`)).text()
    const at = html.indexOf('id="tuntutan-terbaru"')
    expect(at).toBeGreaterThan(0)
    expect(at).toBeLessThan(html.indexOf('id="isu-terbaru"'))
    expect(html).toContain(NATIONAL_TITLE)
    expect(html).toMatch(/href="\/tuntutan"[^>]*>Lihat semua tuntutan</)
    expect(html).not.toContain(DRAFT_TITLE)
    // None published: no section
    const other = await (await get(`${UGM}/`)).text()
    expect(other).not.toContain('id="tuntutan-terbaru"')
  })

  test("a reopened tuntutan drops its closing line", async () => {
    const code = codes[1] ?? ""
    for (const [action, note] of [
      ["close", "Alasan penutupan yang sudah lama."],
      ["reopen", null],
    ] as const) {
      const demand = await getManagedDemand(tenant.id, code)
      const done = await changeDemandState(tenant, {
        code,
        action,
        version: demand?.version ?? 0,
        note,
        actorId: admin,
      })
      expect(done.ok).toBe(true)
    }
    const html = await (await get(`${ITB}/tuntutan/${code}`)).text()
    const hero = html.slice(0, html.indexOf('id="demand-on-page"'))
    expect(hero).toContain("Halte bus layak")
    expect(hero).not.toContain("Alasan penutupan yang sudah lama.")
    expect(hero).not.toContain("Ditutup")
    // History keeps it
    expect(html).toContain("Alasan penutupan yang sudah lama.")
  })

  test("Riwayat links to its sub-tuntutan, updates show status", async () => {
    const html = await (await get(`${ITB}/tuntutan/${codes[0]}`)).text()
    expect(html).toContain('id="sub-1"')
    expect(html).toMatch(
      /<a [^>]*href="#sub-1"[^>]*>Status subtuntutan 1 berubah</,
    )
    const item = html.slice(
      html.indexOf('id="sub-1"'),
      html.indexOf('id="sub-2"'),
    )
    expect(item).toContain("Direspons")
    expect(item).toContain("Pemerintah provinsi menerbitkan standar")
  })

  test("the register leaves out a zero issue count", async () => {
    const html = await (await get(`${ITB}/tuntutan`)).text()
    expect(html).toContain("Halte bus layak")
    expect(html).not.toContain("0 isu terkait")
  })

  test("the apex counts public tuntutan exactly", async () => {
    await su.query("REFRESH MATERIALIZED VIEW public.national_aggregates")
    const html = await (await get("http://localhost/")).text()
    const key = html.slice(
      html.indexOf('id="angka-utama"'),
      html.indexOf("</section>", html.indexOf('id="angka-utama"')),
    )
    // Public content: 1–4 shown exactly
    expect(key).toMatch(
      new RegExp(
        `>${m.data_key_demands()}<span[^>]*>[^<]*</span></dt><dd[^>]*>3</dd>`,
      ),
    )
    expect(html).toContain(m.national_col_demands())
    expect(html).toMatch(
      />itbpub<\/th>(?:<td[^>]*>[^<]*<\/td>){3}<td[^>]*>3<\/td>/,
    )
    expect(html).not.toContain(DRAFT_TITLE)
    expect(html).not.toContain("<script")
  })
})

describe("apex national view", () => {
  // .env APEX_HOST=localhost
  const APEX = "http://localhost"

  beforeAll(async () => {
    await su.query("REFRESH MATERIALIZED VIEW public.national_aggregates")
  })

  test("/ lists every campus with suppressed counts, no JS", async () => {
    const res = await get(`${APEX}/`)
    expect(res.status).toBe(200)
    expectPublic(res)
    const html = await res.text()
    expect(html).toContain(m.national_title())
    for (const host of ["itbpub", "ugmpub", "kmpub"]) {
      expect(html).toContain(`href="http://${host}.localhost"`)
    }
    expect(html).toContain("Terakhir diperbarui")
    // Two published issues: hidden
    expect(html).toContain("1–4")
    expect(html).not.toContain("<script")
    for (const path of ["/lapor", "/masuk", "/isu", "/data", "/lacak"]) {
      expect(html).not.toContain(`href="${path}"`)
    }
    expect(html).toContain('href="/tentang"')
  })

  test("tenant routes are 404 on the apex", async () => {
    for (const path of ["/isu", "/data", "/lapor", "/masuk", "/kelola"]) {
      const res = await get(`${APEX}${path}`)
      expectNotFound(res)
      const html = await res.text()
      expect(html).toContain('href="/#kampus"')
      expect(html).not.toContain('href="/masuk"')
    }
  })

  test("content pages send readers to a campus", async () => {
    for (const path of ["/tentang", "/privasi", "/pedoman"]) {
      const res = await get(`${APEX}${path}`)
      expect(res.status).toBe(200)
      const html = await res.text()
      expect(html).toContain('href="/#kampus"')
      expect(html).not.toContain('href="/lapor"')
    }
  })

  test("footer links accessibility and licence", async () => {
    const res = await get(`${ITB}/aksesibilitas`)
    expectPublic(res)
    const html = await res.text()
    expect(html).toMatch(/<h1[^>]*>[^<]*Pernyataan Aksesibilitas/)
    expect(html).toContain('href="/aksesibilitas"')
    expect(html).toContain('href="/tentang#lisensi"')
    const about = await (await get(`${ITB}/tentang`)).text()
    expect(about).toContain('id="lisensi"')
    expect(about).toContain("OpenStreetMap contributors")
    expect(about).not.toContain('id="akuntabilitas"')
  })

  test("apex policy pages never print an empty campus", async () => {
    const about = await (await get(`${APEX}/tentang`)).text()
    expect(about).not.toMatch(/Sadar Bersuara di \./)
    const privacy = await (await get(`${APEX}/privasi`)).text()
    expect(privacy).toContain(m.privacy_controller_body_national())
    expect(privacy).not.toMatch(/Sadar Bersuara di\s+dikelola/)
  })

  test("unknown query 301s to the canonical URL", async () => {
    const res = await get(`${APEX}/?utm_source=x`)
    expect(res.status).toBe(301)
    expect(res.headers.get("Location")).toBe("/")
  })

  test("before the first refresh the page says so", async () => {
    await su.query(
      "REFRESH MATERIALIZED VIEW public.national_aggregates WITH NO DATA",
    )
    try {
      const html = await (await get(`${APEX}/`)).text()
      expect(html).toContain(m.national_empty_title())
    } finally {
      await su.query("REFRESH MATERIALIZED VIEW public.national_aggregates")
    }
  })

  test("a campus host still renders its own home", async () => {
    const html = await (await get(`${ITB}/`)).text()
    expect(html).not.toContain(m.national_title())
    expect(html).toContain('href="/lapor"')
  })
})

// PLAN §14 item 22
describe("query budget per page", () => {
  let demandCode = ""
  // Demands add fan-out queries
  beforeAll(async () => {
    const { rows } = await su.query<{ id: string }>(
      "SELECT id FROM organizations WHERE slug = 'itbpub'",
    )
    const tenant: DemandTenant = {
      id: rows[0]?.id ?? "",
      host: "itbpub.localhost",
      campusCode: "ITBPUB",
    }
    // Ready dashboard adds the ranking
    await su.query(
      `INSERT INTO dashboard_snapshots (org_id, data, computed_at)
       VALUES ($1, $2, now()) ON CONFLICT (org_id) DO NOTHING`,
      [tenant.id, JSON.stringify(fullSnapshot())],
    )
    const admin = await insertUser(su, "admin.anggaran@contoh.id")
    const created = await createDemand(tenant, {
      fields: {
        scope: "national",
        provinceCode: null,
        regencyCode: null,
        category: "infrastruktur_transportasi",
        title: "Standar layanan air bersih nasional",
        body: "Kami menuntut standar waktu pemulihan suplai air bersih.",
        summary: "Waktu pemulihan suplai air bersih.",
        target: "Kementerian Pekerjaan Umum",
        raisedOn: "2026-07-30",
      },
      items: ["Standar waktu pemulihan", "Tangki air bantuan"],
      actorId: admin,
    })
    if (!created.ok) throw new Error(created.reason)
    demandCode = created.code
    // Cited issue reads the tuntutan
    const linked = await linkIssue(tenant, {
      code: created.code,
      issueCode: PUBLISHED,
      actorId: admin,
    })
    if (!linked.ok) throw new Error(linked.reason)
    const demand = await getManagedDemand(tenant.id, created.code)
    await changeDemandState(tenant, {
      code: created.code,
      action: "publish",
      version: demand?.version ?? 0,
      note: null,
      actorId: admin,
    })
  })

  afterAll(async () => {
    await su.query("DELETE FROM demands")
  })

  // Counts BEGIN, set_config and COMMIT
  const BUDGET: [string, number][] = [
    // First request loads the tenant
    ["/", 16],
    ["/isu", 5],
    [`/isu/${PUBLISHED}`, 15],
    ["/tentang", 0],
    ["/data", 18],
    ["/tuntutan", 15],
    ["/tuntutan/:code", 12],
    ["/api/v1", 1],
    ["/api/v1/isu", 5],
    [`/api/v1/isu/${PUBLISHED}`, 15],
    ["/api/v1/tuntutan", 8],
    ["/api/v1/tuntutan/:code", 12],
    ["/api/v1/data", 14],
    ["/api/v1/data/ringkasan.csv", 14],
    ["/api/v1/data/wilayah.csv", 14],
  ]

  for (const [path, max] of BUDGET) {
    test(`${path} runs at most ${max} statements`, async () => {
      const res = await get(`${ITB}${path.replace(":code", demandCode)}`)
      expect(res.status).toBe(200)
      const header = res.headers.get("Server-Timing") ?? ""
      const count = /desc="(\d+) queries"/.exec(header)?.[1]
      expect(count).toBeDefined()
      expect(Number(count)).toBeLessThanOrEqual(max)
    })
  }
})
