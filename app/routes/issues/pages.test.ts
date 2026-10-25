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
const PUBLISHED = "ISU-2026-10-0001"
const DRAFT = "ISU-2026-10-0002"
const TAKEN = "ISU-2026-10-0003"
const EDITED = "ISU-2026-10-0004"

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
    expect(html).toMatch(/© \d{4} KM itbpub/)
    const missing = await (await get(`${ITB}/isu/${DRAFT}`)).text()
    expect(missing).toMatch(/© \d{4} KM itbpub/)
  })

  test("the list is a rounded card grid with a site title", async () => {
    const html = await (await get(`${ITB}/isu`)).text()
    expect(html).toContain(
      "<title>Jelajah - Sadar Bersuara - KM itbpub</title>",
    )
    expect(html).toMatch(
      /<ul class="mt-6 grid[^"]*"><li><article class="[^"]*rounded-2xl/,
    )
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
      `>${m.issue_stage_label()}</dt>`,
      ">Dibuat<",
      "Warga melaporkan lubang besar",
      'id="tanggapan-title"',
      'id="status-title"',
      'id="riwayat-title"',
    ].map((text) => html.indexOf(text))
    expect(order.every((at) => at > 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    // No page nav, 25 Oct
    expect(html).not.toContain(">Di Halaman Ini<")
    expect(html).not.toContain('href="#tanggapan"')
    expect(html.match(/aria-current="step"/g)).toHaveLength(1)
    expect(html).toContain("Belum ada tanggapan resmi.")
    // Root scroll-padding covers the header
    expect(html).not.toContain("scroll-mt-")
    expect(html).toContain(m.issue_advocacy_note())
  })

  test("the issue page offers no complaint form", async () => {
    const page = await (await get(`${ITB}/isu/${PUBLISHED}`)).text()
    expect(page).not.toContain("/laporkan")
    expect(page).not.toContain("Disunting admin")
    expectNotFound(await get(`${ITB}/isu/${PUBLISHED}/laporkan`))
    expectNotFound(await get(`${ITB}/aduan/ADU-ITB-26-7K3QX`))
  })

  test("a redacted issue says so with its date", async () => {
    const page = await (await get(`${ITB}/isu/${EDITED}`)).text()
    const main = page.slice(page.indexOf("<main"))
    expect(main).toContain("Disunting admin pada 13 Oktober 2026")
    expect(main).not.toContain("/pedoman#standar")
  })

  test("a taken-down issue answers 410 with the guidelines", async () => {
    const res = await get(`${ITB}/isu/${TAKEN}`)
    expect(res.status).toBe(410)
    expect(res.headers.get("Cache-Control")).toBe("no-store")
    const html = await res.text()
    expect(html).toContain(m.issue_taken_down_title())
    expect(html).toContain("14 Oktober 2026")
    expect(html).toContain('href="/pedoman"')
    expect(html).not.toContain("/pedoman#standar")
    expect(html).not.toContain("Isu yang sudah diturunkan")
    // Other campuses still 404
    expectNotFound(await get(`${UGM}/isu/${TAKEN}`))
  })

  test("a missing issue gets its own 404 page", async () => {
    const res = await get(`${ITB}/isu/${DRAFT}`)
    expectNotFound(res)
    const html = await res.text()
    expect(html).toContain("Isu Tidak Ditemukan")
    expect(html).toContain("<title>Isu Tidak Ditemukan - Sadar Bersuara")
    expect(html).not.toContain("Draf belum terbit")
    // Static import keeps it inline
    expect(html).not.toMatch(/\$RC|<template/)
    const main = html.slice(html.indexOf("<main"), html.indexOf("</main>"))
    expect(main).toMatch(/<a [^>]*href="\/isu"[^>]*>Jelajah<\/a>/)
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
    expect(html).toMatch(/© \d{4} KM itbpub/)
    expect(html).toContain('href="/lapor"')
    const other = await (await get(`${UGM}/tidak-ada`)).text()
    expect(other).toMatch(/© \d{4} KM ugmpub/)
  })

  test("a /kelola 403 keeps the tenant shell", async () => {
    const res = await get(`${ITB}/kelola`)
    expect(res.status).toBe(403)
    const html = await res.text()
    expect(html).toContain(
      "<title>Akses Ditolak - Sadar Bersuara - KM itbpub</title>",
    )
    expect(html).toContain("<footer")
    expect(html).toMatch(/© \d{4} KM itbpub/)
    expect(html).not.toMatch(/\$RC|<template/)
    const page = html.slice(html.indexOf("Akses Ditolak</h1>"))
    expect(page.slice(0, page.indexOf("</main>"))).toMatch(
      /href="\/masuk"[^>]*>Masuk</,
    )
  })

  test("an invalid or out-of-range page redirects", async () => {
    const cases: [string, number, string][] = [
      ["?halaman=0", 301, "/isu"],
      ["?halaman=1&urut=laporan", 301, "/isu?urut=laporan"],
      ["?halaman=abc&kursor=x", 301, "/isu"],
      // Data-dependent, not cached
      ["?halaman=9", 302, "/isu"],
      ["?halaman=9&status=done", 302, "/isu?status=done"],
    ]
    for (const [search, status, location] of cases) {
      const res = await get(`${ITB}/isu${search}`)
      expect([res.status, res.headers.get("Location")]).toEqual([
        status,
        location,
      ])
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
      publicCode: `ISU-2026-10-${100 + i}`,
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
      const html = await (await get(`${ITB}/isu?urut=laporan`)).text()
      const nav = html.slice(html.indexOf('<nav aria-label="Halaman hasil"'))
      expect(nav).toMatch(/^<nav aria-label="Halaman hasil"/)
      expect(nav).toContain("Halaman 1 dari 2")
      expect(nav).not.toContain("Sebelumnya")
      expect(nav).toMatch(
        /<a [^>]*href="\/isu\?halaman=2&amp;urut=laporan"[^>]*>Berikutnya<\/a>/,
      )
      const second = await (
        await get(`${ITB}/isu?halaman=2&urut=laporan`)
      ).text()
      expect(second).toContain("Daftar Isu, Halaman 2")
      const last = second.slice(second.indexOf('aria-label="Halaman hasil"'))
      expect(last).toContain("Halaman 2 dari 2")
      expect(last).toMatch(
        /<a [^>]*href="\/isu\?urut=laporan"[^>]*>Sebelumnya<\/a>/,
      )
      expect(last.slice(0, last.indexOf("</nav>"))).not.toContain("Berikutnya")
      const past = await get(`${ITB}/isu?halaman=5&urut=laporan`)
      expect(past.status).toBe(302)
      expect(past.headers.get("Location")).toBe("/isu?halaman=2&urut=laporan")
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
      publicCode: `ISU-2026-10-${number}`,
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
    expect(await (await get(`${UGM}/`)).text()).toContain("Belum ada isu.")
    expect(html).not.toContain("Baru Ditanggapi Instansi")
    expect(html).not.toContain("Selesai Terkonfirmasi")
    expect(html).not.toContain("/km-itb/")
  })

  test("ends with one next step, never on an empty list", async () => {
    const closing = /<a [^>]*href="\/isu"[^>]*>Jelajah<\/a>/
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
        expect(list).toContain(`href="/isu/ISU-2026-10-${number}"`)
      }
      expect(html).not.toContain("ISU-2026-10-303")
      expect(list).toContain(">Selesai<")
      expect(list).toContain(">Ditanggapi<")
      // Place only, no count
      expect(list).toContain('<p class="mt-1 mb-4 text-sm">Kota Bandung</p>')
      expect(list).not.toContain("3 laporan")
      const other = await (await get(`${UGM}/`)).text()
      expect(other).not.toContain("ISU-2026-10-30")
      expect(other).toContain("Belum ada isu.")
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
    expect(html).toContain("Laporkan Masalah Publik</span> <br/><span")
    expect(html).toContain('href="/masuk?daftar=1"')
    expect(html).not.toMatch(/laporan masuk|isu aktif|Pantauan/)
  })
})

describe("KM ITB tenant assets", () => {
  test("only the KM ITB set gets its logo and star", async () => {
    const home = await (await get(`${KM}/`)).text()
    // Header and footer logo
    expect(home.match(/src="\/km-itb\/logo-tangan.webp"/g)).toHaveLength(2)
    expect(home).not.toContain('src="/logo.svg"')
    expect(home.match(/navlink-star/g)).toHaveLength(1)
    // 3x file in header, footer
    expect(home.match(/srcSet="[^"]*logo-tangan-168.webp 3x"/g)).toHaveLength(2)
    // KM emblem beside both
    expect(home.match(/src="\/km-itb\/logo-km.webp"/g)).toHaveLength(2)
    // Home ornaments follow root
    expect(home).toContain('src="/km-itb/rings-45.svg"')
    const list = await (await get(`${KM}/isu`)).text()
    expect(list).toMatch(
      /href="\/isu"[^>]*>(?:(?!<\/a>).)*\/km-itb\/navlink-star.webp/,
    )
    const forbidden = await (await get(`${KM}/kelola`)).text()
    expect(forbidden).toContain('src="/km-itb/logo-tangan.webp"')
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

  test("About is an editorial split on the page", async () => {
    const html = await (await get(`${KM}/tentang`)).text()
    expect(html).not.toContain("/km-itb/about/")
    // No bands since 21 Oct
    for (const band of ["bg-band", "bg-home-list", "highlight-box"]) {
      expect(html).not.toContain(band)
    }
    for (const id of ["prinsip", "cara-kerja", "metode"]) {
      expect(html).toMatch(
        new RegExp(`<h2 id="${id}" class="inline-block bg-highlight`),
      )
    }
    expect(html).toContain("lg:grid-cols-12")
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

  test("the issue page has no privacy box", async () => {
    const html = await (await get(`${ITB}/isu/${PUBLISHED}`)).text()
    const main = html.slice(html.indexOf("<main"), html.indexOf("</main>"))
    // Removed 25 Oct
    expect(main).not.toContain("cukup laporan.")
    expect(main).not.toContain('href="/privasi"')
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
    // Detail never links to summary
    expect(main).not.toContain('href="/#cara-kerja"')
    // Policies live in the footer
    expect(main).not.toContain('id="privasi"')
    expect(main).not.toContain('href="/privasi')
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
    // Checklist link removed by team
    expect(main).not.toContain('href="/pedoman')
    expect(main).not.toContain("Judul dan ringkasan tidak memuat data pribadi")
    expect(main).not.toContain("sebelum digabung")
    const guide = await (await get(`${ITB}/pedoman`)).text()
    expect(guide).toContain('id="pemeriksaan"')
  })

  test("Privacy keeps age, location and contact", async () => {
    const html = await (await get(`${ITB}/privasi`)).text()
    expect(html).not.toContain('id="masa-simpan"')
    expect(html).not.toContain('id="pihak-lain"')
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
    const html = await (await get(`${ITB}/privasi`)).text()
    expect(html).toContain("disetujui admin")
  })

  test("Guidelines keep scope and review, no standards", async () => {
    const html = await (await get(`${ITB}/pedoman`)).text()
    expect(html).not.toContain('id="standar"')
    expect(html).not.toContain("Standar Konten")
    expect(html).toContain("Judul dan ringkasan tidak memuat data pribadi")
    expect(html).toContain("Status laporan Anda di halaman Laporan saya")
    expect(html).not.toContain("Hubungi pengurus")
    expect(html).not.toContain('id="nonpartisan"')
    expect(html).not.toContain('id="perintah"')
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
  // Public stages, sum 26
  const zeroStatuses = {
    verified: 10,
    referred: 2,
    responded: 6,
    in_progress: 3,
    done: 5,
  }
  return {
    v: 8,
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
    resolution: { done: 5, published: 8, share: 0.625 },
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
    expect(html).toMatch(/href="\/isu"[^>]*>Jelajah</)
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
    // No data notes, 25 Oct
    expect(html).not.toContain("Terakhir diperbarui")
    expect(html).not.toContain('id="angka-utama"')
    expect(html).not.toContain("Pembaruan angka tertunda")
    // Note, figures, map, responses, ranking
    const low = html.indexOf("Baru 64 laporan")
    const figures = html.indexOf('id="angka-laporan"')
    const demandFigures = html.indexOf(">Angka Tuntutan</h2>")
    const map = html.indexOf('id="peta-isu"')
    const responses = html.indexOf('id="tanggapan-instansi"')
    const ranking = html.indexOf('id="peringkat-isu"')
    expect(low).toBeGreaterThan(0)
    expect(figures).toBeGreaterThan(low)
    expect(demandFigures).toBeGreaterThan(figures)
    expect(map).toBeGreaterThan(demandFigures)
    expect(responses).toBeGreaterThan(map)
    expect(ranking).toBeGreaterThan(responses)
    // Under 100 reports
    expect(html).toContain("Baru 64 laporan sejak 2 Maret 2026")
    // Verified reports per stage
    const reports = html.slice(figures, demandFigures)
    expect(reports).toContain(">Angka Laporan</h2>")
    expect(reports).toMatch(/>Laporan terverifikasi<\/span><\/dt><dd[^>]*>26</)
    expect(reports).toMatch(/>Diteruskan ke instansi<\/span><\/dt><dd[^>]*>0</)
    expect(reports).toMatch(/>Selesai<\/span><\/dt><dd[^>]*>0</)
    // Removed 25 Oct, team request
    expect(html).not.toMatch(/<h3[^>]*>Isu Selesai<\/h3>/)
    expect(html).not.toContain("Kinerja Moderasi")
    expect(html).not.toContain("Tren Laporan dan Sebaran Isu")
    expect(html).not.toContain('id="grafik"')
    expect(html).not.toContain("Tuntutan Publik")
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
    // No Standar anywhere, 25 Oct
    expect(html).not.toContain("Standar")
    // No Tentang Data, 25 Oct
    expect(html).not.toContain('id="tentang-data"')
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
    expect(html).not.toMatch(
      /<a href="\/isu\?wilayah=[^"]*" class="[^"]*outline-none/,
    )
    // Verified reports, 1–4 hidden
    expect(html).toContain("Jawa Barat: 22 laporan terverifikasi")
    expect(html).toContain(
      "Daerah Istimewa Yogyakarta: 1–4 laporan terverifikasi",
    )
    expect(html).toContain("Aceh: 0 laporan terverifikasi")
    // Report layer only, 25 Oct
    expect(html).toContain(">Peta Laporan</h2>")
    expect(html).not.toContain("lapisan=")
    expect(html).toContain("OpenStreetMap contributors")
    expect(html).toContain("Open Database License (ODbL)")
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
    // Ruled table, count column
    expect(ranking).toMatch(
      new RegExp(`<th[^>]*>${m.data_ranking_col_reports()}</th>`),
    )
    expect(ranking).toMatch(/<td[^>]*>1<\/td><\/tr>/)
    expect(html).not.toContain('id="tentang-data"')
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
    expect(tab).toContain(`>${m.data_ranking_col_days()}</th>`)
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
    briefUrl: null,
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

  test("/data counts tuntutan above the map, no list", async () => {
    const html = await (await get(`${ITB}/data`)).text()
    const start = html.indexOf(">Angka Tuntutan</h2>")
    const figures = html.slice(start, html.indexOf('id="peta-isu"'))
    expect(start).toBeGreaterThan(html.indexOf('id="angka-laporan"'))
    // Three public, one draft
    expect(figures).toMatch(/>Total tuntutan<\/span><\/dt><dd[^>]*>3</)
    expect(figures).toMatch(/>Tuntutan dalam proses<\/span><\/dt><dd[^>]*>3</)
    expect(figures).toMatch(/>Tuntutan dipenuhi<\/span><\/dt><dd[^>]*>0</)
    expect(figures).toContain("dari 6 subtuntutan")
    // Section removed 25 Oct
    expect(html).not.toContain('id="tuntutan-publik"')
    expect(html).not.toContain(`href="/tuntutan/${codes[2]}"`)
    expect(html).not.toContain(NATIONAL_TITLE)
    expect(html).not.toContain(DRAFT_TITLE)
    // Figures, map, answers, ranking
    const order = [
      'id="angka-laporan"',
      'id="peta-isu"',
      'id="tanggapan-instansi"',
      'id="peringkat-isu"',
    ].map((marker) => html.indexOf(marker))
    expect(order.every((at) => at > 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })

  test("the old Tuntutan map layer redirects", async () => {
    const res = await get(`${ITB}/data?lapisan=tuntutan&tampilan=tabel`)
    expect(res.status).toBe(301)
    expect(res.headers.get("Location")).toBe("/data?tampilan=tabel")
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
    const hero = html.slice(0, html.indexOf('id="sub-tuntutan"'))
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
    // Fulfilment only, no response
    expect(item).not.toContain("Direspons")
    expect(item).toContain("Pemerintah provinsi menerbitkan standar")
  })

  test("the register leaves out a zero issue count", async () => {
    const html = await (await get(`${ITB}/tuntutan`)).text()
    expect(html).toContain("Halte bus layak")
    expect(html).not.toContain("0 isu terkait")
  })

  test("ranking starts on the list, not the detail page", async () => {
    const html = await (await get(`${ITB}/tuntutan`)).text()
    const panel = html.indexOf('id="susun-peringkat"')
    // Above scorecard and filters
    expect(panel).toBeGreaterThan(0)
    expect(panel).toBeLessThan(html.indexOf('action="/tuntutan"'))
    const block = html.slice(panel, html.indexOf("</section>", panel))
    expect(block).toContain(m.demands_rank_cta_lead())
    expect(block).not.toMatch(/lima/i)
    expect(block).toMatch(
      /<a [^>]*href="\/tuntutan\/peringkat"[^>]*>Susun peringkat Anda<\/a>/,
    )
    const detail = await (await get(`${ITB}/tuntutan/${codes[0]}`)).text()
    expect(detail).not.toContain('id="peringkat-warga"')
    expect(detail).not.toContain('href="/tuntutan/peringkat"')
  })

  test("the register is a card grid", async () => {
    const html = await (await get(`${ITB}/tuntutan`)).text()
    const main = html.slice(html.indexOf("<main"), html.indexOf("</main>"))
    expect(main).not.toContain("<table")
    const cards = main.match(/<article[\s\S]*?<\/article>/g) ?? []
    expect(cards).toHaveLength(3)
    const card = cards.find((one) => one.includes(codes[0] ?? "-")) ?? ""
    expect(card).toContain(">Infrastruktur dan Transportasi</span>")
    expect(card).toMatch(
      new RegExp(
        `<a [^>]*href="/tuntutan/${codes[0]}"[^>]*>${FIELDS.title}</a>`,
      ),
    )
    expect(card).toContain(">Sebagian dipenuhi</span>")
    expect(card).toContain("1 dari 2 subtuntutan dipenuhi")
    expect(card).toContain("Diajukan 30 Juli 2026")
    expect(card).not.toContain("·")
    expect(card).not.toContain("<svg")
    expect(card).not.toContain("font-ui")
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
      if (path === "/tentang") expect(html).toContain('href="/#kampus"')
      expect(html).not.toContain('href="/lapor"')
    }
  })

  test("footer links accessibility, no licence anchor", async () => {
    const res = await get(`${ITB}/aksesibilitas`)
    expectPublic(res)
    const html = await res.text()
    expect(html).toMatch(/<h1[^>]*>[^<]*Pernyataan Aksesibilitas/)
    expect(html).toContain('href="/aksesibilitas"')
    // Map credits OSM itself
    expect(html).not.toContain('href="/tentang#lisensi"')
    const about = await (await get(`${ITB}/tentang`)).text()
    expect(about).not.toContain('id="lisensi"')
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
