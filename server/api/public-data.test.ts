import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { drizzle } from "drizzle-orm/node-postgres"
import {
  changeDemandState,
  createDemand,
  type DemandFields,
  type DemandTenant,
  getManagedDemand,
  linkIssue,
} from "../../app/features/demands/manage.server.ts"
import { m } from "../../app/paraglide/messages.js"
import { migrate } from "../../db/migrate.ts"
import {
  issueEvents,
  issues,
  referrals,
  responses,
} from "../../db/schema/issues.ts"
import { reports } from "../../db/schema/reports.ts"
import {
  insertOrg,
  insertRegions,
  insertUser,
  reportValues,
  resetData,
  superuserPool,
  testUrl,
} from "../../db/testing.ts"
import {
  CATEGORY_FILTERS,
  type DashboardSnapshot,
  filterKey,
  STATUS_FILTERS,
} from "../../shared/dashboard.ts"
import { createApp } from "../app.ts"
import { apexHost } from "../origin.server.ts"
import { DATASET_IDS } from "./datasets.ts"

// Tenant cache is per-process
const ITB = "http://itbapi.localhost"
const UGM = "http://ugmapi.localhost"
const PUBLISHED = "ISU-2026-10-0001"
const DRAFT = "ISU-2026-10-0002"
const TAKEN = "ISU-2026-10-0003"
const ADMIN_EMAIL = "admin.api@contoh.id"
const LICENSE = "https://creativecommons.org/licenses/by/4.0/"

const su = superuserPool()
const suDb = drizzle({ client: su })

function makeApp(apiRateLimit?: { max: number; windowMs: number }) {
  return createApp({
    handleDocument: async () => new Response("document", { status: 404 }),
    health: {
      db: async () => {},
      jobs: async () => ({ ok: true, checks: {} }),
    },
    log: () => {},
    apiRateLimit,
  })
}
const app = makeApp()

function get(url: string, headers: Record<string, string> = {}) {
  return app.request(url, { headers })
}

function expectPublic(res: Response) {
  expect(res.headers.get("Cache-Control")).toBe(
    "public, max-age=0, no-transform",
  )
  expect(res.headers.get("Cloudflare-CDN-Cache-Control")).toBe(
    "max-age=60, stale-while-revalidate=30, stale-if-error=86400",
  )
  expect(res.headers.get("Set-Cookie")).toBeNull()
  expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*")
  expect(res.headers.get("ETag")).toMatch(/^W\/"/)
  expect(res.headers.get("Link")).toContain(`<${LICENSE}>; rel="license"`)
}

async function expectError(res: Response, status: number, error: string) {
  expect(res.status).toBe(status)
  expect(res.headers.get("Cache-Control")).toBe("no-store")
  expect(res.headers.get("Cloudflare-CDN-Cache-Control")).toBeNull()
  expect(res.headers.get("Content-Type")).toStartWith("application/json")
  expect(await res.json()).toMatchObject({ error })
}

// Keys that would mean PII
const PII_KEYS =
  /^(email|phone|phoneNumber|phone_number|userId|user_id|ipAddress|ip_address|userAgent|user_agent|createdBy|decidedBy|name|story|point|lat|lng|declaredName|contact|addressHash|clientHash)$/i

function walk(value: unknown, path: string, found: string[]): void {
  if (Array.isArray(value)) {
    for (const [i, one] of value.entries()) walk(one, `${path}[${i}]`, found)
  } else if (value && typeof value === "object") {
    for (const [key, one] of Object.entries(value)) {
      if (PII_KEYS.test(key)) found.push(`${path}.${key}`)
      walk(one, `${path}.${key}`, found)
    }
  } else if (typeof value === "string" && /\S+@\S+\.\S+/.test(value)) {
    found.push(`${path}=${value}`)
  }
}

function piiIn(body: unknown): string[] {
  const found: string[] = []
  walk(body, "$", found)
  return found
}

// PRIV-03: the guard itself
test("the no-PII guard knows every personal key", () => {
  const leaked = {
    a: { point: { lat: -6.9, lng: 107.6 } },
    b: { story: "x", phoneNumber: "+62", phone_number: "+62" },
    c: { declaredName: "x", contact: "x", decidedBy: "x", userAgent: "x" },
    d: { ip_address: "x", addressHash: "x", clientHash: "x", Email: "x" },
  }
  expect(piiIn(leaked).sort()).toEqual(
    [
      "$.a.point",
      "$.a.point.lat",
      "$.a.point.lng",
      "$.b.story",
      "$.b.phoneNumber",
      "$.b.phone_number",
      "$.c.declaredName",
      "$.c.contact",
      "$.c.decidedBy",
      "$.c.userAgent",
      "$.d.ip_address",
      "$.d.addressHash",
      "$.d.clientHash",
      "$.d.Email",
    ].sort(),
  )
})

function snapshot(): DashboardSnapshot {
  const data: DashboardSnapshot = {
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
    resolution: { done: 5, published: 26, share: 0.19 },
    trend: [{ month: "2026-10", received: 10, verified: 5 }],
    trendTotal: 10,
    categories: { program: 20, bencana: 6, bansos: 0 },
    statuses: {
      verified: 4,
      referred: 8,
      responded: 6,
      in_progress: 0,
      done: 5,
    },
    verifiedProvinces: { "all|all": { "32": 22, "34": null } },
    verifiedProvinceTotals: { "all|all": 26 },
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
  }
  // Worker writes every key
  for (const category of CATEGORY_FILTERS) {
    for (const status of STATUS_FILTERS) {
      data.verifiedProvinces[filterKey(category, status)] ??= {}
      data.verifiedProvinceTotals[filterKey(category, status)] ??= 0
    }
  }
  return data
}

const FIELDS: DemandFields = {
  scope: "regional",
  provinceCode: "32",
  regencyCode: null,
  category: "infrastruktur_transportasi",
  title: "Standar layanan air bersih di Jawa Barat",
  body: "Kami menuntut standar waktu pemulihan suplai air bersih.",
  summary: "Waktu pemulihan suplai air dan tangki air bantuan.",
  target: "Pemerintah Provinsi Jawa Barat",
  raisedOn: "2026-07-30",
  briefUrl: null,
}
let demandCode = ""
let draftDemand = ""

beforeAll(async () => {
  await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
  await resetData(su)
  await insertRegions(su)
  const orgId = await insertOrg(su, "itbapi")
  await insertOrg(su, "ugmapi")
  const base = {
    orgId,
    year: 2026,
    title: "Jalan berlubang di Dago",
    summary: "Warga melaporkan lubang besar di jalan utama Dago.",
    categoryId: "program",
    subcategoryId: "program.infrastruktur",
    provinceCode: "32",
    regencyCode: "32.73",
    reportCount: 3,
  }
  const [published] = await suDb
    .insert(issues)
    .values([
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
    ])
    .returning({ id: issues.id })
  const issueId = published?.id ?? ""
  const admin = await insertUser(su, ADMIN_EMAIL)
  await suDb.insert(referrals).values({
    orgId,
    issueId,
    kind: "referral",
    agency: "Dinas PU Kota Bandung",
    channel: "agency_email",
    ticket: "PU-77",
    sentOn: "2026-10-01",
    deadlineOn: "2026-10-15",
    createdBy: admin,
  })
  await suDb.insert(responses).values({
    orgId,
    issueId,
    agency: "Dinas PU Kota Bandung",
    body: "Perbaikan dijadwalkan pekan depan.",
    respondedOn: "2026-10-10",
    sourceUrl: "https://pu.bandung.go.id/berita/1",
    createdBy: admin,
  })
  await suDb.insert(issueEvents).values({
    orgId,
    issueId,
    action: "refer",
    advocacyStatus: "referred",
    govStatus: "awaiting_response",
    note: null,
  })
  await su.query(
    "INSERT INTO dashboard_snapshots (org_id, data, computed_at) VALUES ($1, $2, now() - interval '5 minutes')",
    [orgId, JSON.stringify(snapshot())],
  )
  const tenant: DemandTenant = {
    id: orgId,
    host: "itbapi.localhost",
    campusCode: "ITBAPI",
  }
  const created = await createDemand(tenant, {
    fields: FIELDS,
    items: ["Standar waktu pemulihan", "Tangki air bantuan"],
    actorId: admin,
  })
  if (!created.ok) throw new Error(created.reason)
  demandCode = created.code
  await linkIssue(tenant, {
    code: demandCode,
    issueCode: PUBLISHED,
    actorId: admin,
  })
  const managed = await getManagedDemand(orgId, demandCode)
  await changeDemandState(tenant, {
    code: demandCode,
    action: "publish",
    version: managed?.version ?? 0,
    note: null,
    actorId: admin,
  })
  const draft = await createDemand(tenant, {
    fields: { ...FIELDS, title: "Tuntutan draf" },
    items: ["Satu"],
    actorId: admin,
  })
  if (!draft.ok) throw new Error(draft.reason)
  draftDemand = draft.code
})

afterAll(async () => {
  await resetData(su)
  await su.end()
})

describe("issue JSON", () => {
  test("a published issue with its public record", async () => {
    const res = await get(`${ITB}/api/v1/isu/${PUBLISHED}`)
    expect(res.status).toBe(200)
    expectPublic(res)
    expect(res.headers.get("Link")).toContain(
      `<http://itbapi.localhost/isu/${PUBLISHED}>; rel="alternate"; type="text/html"`,
    )
    const body = await res.json()
    expect(body.meta).toEqual({
      license: "CC-BY-4.0",
      licenseUrl: LICENSE,
      attribution:
        "KM itbapi. Sadar Bersuara di itbapi. http://itbapi.localhost/isu/ISU-2026-10-0001. Data berlisensi CC BY 4.0.",
      source: `http://itbapi.localhost/isu/${PUBLISHED}`,
    })
    expect(body.issue).toMatchObject({
      code: PUBLISHED,
      title: "Jalan berlubang di Dago",
      summary: "Warga melaporkan lubang besar di jalan utama Dago.",
      provinceName: "Jawa Barat",
      regencyName: "Kota Bandung",
      reportCount: 3,
      verificationLabel: "unverified",
      redactedAt: null,
    })
    expect(body.issue.referrals).toEqual([
      expect.objectContaining({
        agency: "Dinas PU Kota Bandung",
        ticket: "PU-77",
        deadlineOn: "2026-10-15",
      }),
    ])
    expect(body.issue.responses[0]).toMatchObject({
      body: "Perbaikan dijadwalkan pekan depan.",
      sourceUrl: "https://pu.bandung.go.id/berita/1",
    })
    expect(body.issue.events[0]).toMatchObject({ action: "refer" })
    expect(body.issue.evidence).toEqual([])
    expect(body.issue.demands).toEqual([
      {
        code: demandCode,
        title: FIELDS.title,
        url: `http://itbapi.localhost/tuntutan/${demandCode}`,
      },
    ])
    expect(piiIn(body)).toEqual([])
  })

  test("unpublished and other tenants' issues are 404", async () => {
    await expectError(await get(`${ITB}/api/v1/isu/${DRAFT}`), 404, "not_found")
    await expectError(
      await get(`${UGM}/api/v1/isu/${PUBLISHED}`),
      404,
      "not_found",
    )
    await expectError(await get(`${ITB}/api/v1/isu/xyz`), 404, "not_found")
  })

  test("a taken-down issue is 410 with the standard only", async () => {
    const res = await get(`${ITB}/api/v1/isu/${TAKEN}`)
    await expectError(res.clone(), 410, "taken_down")
    const body = await res.json()
    expect(body).toEqual({
      error: "taken_down",
      takenDownAt: "2026-10-14T03:00:00.000Z",
      reason: "standard_11",
    })
    await expectError(await get(`${UGM}/api/v1/isu/${TAKEN}`), 404, "not_found")
  })

  test("a lowercase code redirects to the canonical URL", async () => {
    const res = await get(`${ITB}/api/v1/isu/${PUBLISHED.toLowerCase()}`)
    expect(res.status).toBe(301)
    expect(res.headers.get("Location")).toBe(`/api/v1/isu/${PUBLISHED}`)
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*")
  })

  test("the list holds published issues only", async () => {
    const res = await get(`${ITB}/api/v1/isu`)
    expect(res.status).toBe(200)
    expectPublic(res)
    const body = await res.json()
    expect(body.issues.map((issue: { code: string }) => issue.code)).toEqual([
      PUBLISHED,
    ])
    expect(body.issues[0].url).toBe(`http://itbapi.localhost/isu/${PUBLISHED}`)
    expect(body.issues[0].api).toBe(
      `http://itbapi.localhost/api/v1/isu/${PUBLISHED}`,
    )
    expect(body.next).toBeNull()
    expect(piiIn(body)).toEqual([])
    const other = await (await get(`${UGM}/api/v1/isu`)).json()
    expect(other.issues).toEqual([])
  })

  test("Given published evidence, when the issue JSON is read, then media URLs are absolute on the campus host", async () => {
    const orgId = await insertOrg(su, "mediaapi")
    const [issue] = await suDb
      .insert(issues)
      .values({
        orgId,
        year: 2026,
        number: 1,
        publicCode: "ISU-2026-10-0001",
        title: "Banjir di Coblong",
        summary: "Genangan setinggi lutut setelah hujan deras.",
        categoryId: "program",
        subcategoryId: "program.infrastruktur",
        provinceCode: "32",
        regencyCode: "32.73",
        reportCount: 1,
        publishedAt: new Date(),
      })
      .returning({ id: issues.id })
    const user = await insertUser(su, "bukti.api@contoh.id")
    const [report] = await suDb
      .insert(reports)
      .values(reportValues(orgId, user, { status: "merged" }))
      .returning({ id: reports.id })
    await su.query(
      "INSERT INTO issue_reports (org_id, issue_id, report_id) VALUES ($1, $2, $3)",
      [orgId, issue?.id, report?.id],
    )
    const image = `${"a".repeat(64)}.webp`
    const video = `${"b".repeat(64)}.mp4`
    const poster = `${"c".repeat(64)}.webp`
    const published = [
      ["image", { type: "image", file: image, page: 0, width: 4, height: 3 }],
      [
        "video",
        {
          type: "video",
          file: video,
          poster,
          store: "local",
          width: 8,
          height: 6,
        },
      ],
    ] as const
    for (const [position, [kind, media]] of published.entries()) {
      await su.query(
        `INSERT INTO evidence (org_id, report_id, position, kind, declared_name,
           declared_type, declared_size, status, decision, decided_at,
           public_media, published_at)
         VALUES ($1, $2, $3, $4, 'f', 'image/jpeg', 1, 'published',
           'no_redaction', now(), $5, now())`,
        [orgId, report?.id, position, kind, JSON.stringify([media])],
      )
    }
    const res = await get(
      "http://mediaapi.localhost/api/v1/isu/ISU-2026-10-0001",
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    const origin = "http://mediaapi.localhost/media"
    expect(body.issue.evidence).toEqual([
      {
        kind: "image",
        redacted: false,
        media: [
          {
            type: "image",
            file: image,
            src: `${origin}/${image}`,
            page: 0,
            width: 4,
            height: 3,
          },
        ],
      },
      {
        kind: "video",
        redacted: false,
        media: [
          {
            type: "video",
            src: `${origin}/${video}`,
            poster: `${origin}/${poster}`,
            width: 8,
            height: 6,
          },
        ],
      },
    ])
    expect(piiIn(body)).toEqual([])
  })

  test("Given more issues than one page, when a client follows next, then it gets the rest without a redirect", async () => {
    const orgId = await insertOrg(su, "halapi")
    await suDb.insert(issues).values(
      Array.from({ length: 16 }, (_, i) => ({
        orgId,
        year: 2026,
        number: i + 1,
        publicCode: `ISU-2026-10-${String(i + 1).padStart(4, "0")}`,
        title: `Isu halaman ${i + 1}`,
        summary: "Ringkasan isu untuk uji halaman berikutnya.",
        categoryId: "program",
        subcategoryId: "program.infrastruktur",
        provinceCode: "32",
        regencyCode: "32.73",
        reportCount: 1,
        publishedAt: new Date(Date.UTC(2026, 9, 1, 0, i)),
      })),
    )
    const first = await get(
      "http://halapi.localhost/api/v1/isu?kategori=program",
    )
    expect(first.status).toBe(200)
    const page = await first.json()
    expect(page.issues).toHaveLength(15)
    expect(page.next).toBe(
      "http://halapi.localhost/api/v1/isu?halaman=2&kategori=program",
    )
    const second = await get(page.next)
    expect(second.status).toBe(200)
    const rest = await second.json()
    const codes = (body: { issues: { code: string }[] }) =>
      body.issues.map((issue) => issue.code)
    expect(codes(rest)).toEqual(["ISU-2026-10-0001"])
    expect(new Set([...codes(page), ...codes(rest)]).size).toBe(16)
    expect(rest.next).toBeNull()
  })

  test("bad list queries are refused before any read", async () => {
    await expectError(await get(`${ITB}/api/v1/isu?q=ab`), 400, "short_query")
    // Old cursor links: canonical redirect
    const old = await get(`${ITB}/api/v1/isu?kursor=bad`)
    expect(old.status).toBe(301)
    expect(old.headers.get("Location")).toBe("/api/v1/isu")
    const res = await get(`${ITB}/api/v1/isu?utm_source=x`)
    expect(res.status).toBe(301)
    expect(res.headers.get("Location")).toBe("/api/v1/isu")
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*")
    expect(res.headers.get("Cache-Control")).toBe(
      "public, max-age=0, no-transform",
    )
  })
})

describe("tuntutan JSON", () => {
  test("a published demand without rater names", async () => {
    const res = await get(`${ITB}/api/v1/tuntutan/${demandCode}`)
    expect(res.status).toBe(200)
    expectPublic(res)
    const body = await res.json()
    expect(body.demand).toMatchObject({
      code: demandCode,
      title: FIELDS.title,
      body: FIELDS.body,
      target: FIELDS.target,
      state: "published",
      provinceName: "Jawa Barat",
    })
    expect(
      body.demand.items.map((item: { body: string }) => item.body),
    ).toEqual(["Standar waktu pemulihan", "Tangki air bantuan"])
    expect(body.demand.rank).toEqual({ place: null, rankers: 0 })
    expect(body.demand.ranking).toEqual({ rankers: 0, ranked: 0, shown: false })
    expect(body.demand).not.toHaveProperty("importance")
    expect(body.demand.issues).toEqual([
      {
        code: PUBLISHED,
        title: "Jalan berlubang di Dago",
        url: `http://itbapi.localhost/isu/${PUBLISHED}`,
      },
    ])
    expect(body.demand).not.toHaveProperty("named")
    expect(piiIn(body)).toEqual([])
  })

  test("Given a published, scanned brief, when the demand JSON is read, then the item links the PDF absolutely", async () => {
    const { rows } = await su.query<{ id: string; org_id: string }>(
      `SELECT i.id, i.org_id FROM demand_items i JOIN demands d ON d.id = i.demand_id
       WHERE d.public_code = $1 ORDER BY i.position LIMIT 1`,
      [demandCode],
    )
    const item = rows[0]
    const brief = await su.query<{ id: string }>(
      `INSERT INTO policy_briefs (org_id, item_id, status, sha256, byte_size, scanned_at, published_at)
       VALUES ($1, $2, 'clean', $3, 2048, now(), now()) RETURNING id`,
      [item?.org_id, item?.id, "d".repeat(64)],
    )
    try {
      const body = await (
        await get(`${ITB}/api/v1/tuntutan/${demandCode}`)
      ).json()
      expect(
        body.demand.items.map((one: { brief: unknown }) => one.brief),
      ).toEqual([
        {
          byteSize: 2048,
          url: `http://itbapi.localhost/tuntutan/${demandCode}/dokumen/${brief.rows[0]?.id}.pdf`,
        },
        null,
      ])
    } finally {
      await su.query("DELETE FROM policy_briefs WHERE id = $1", [
        brief.rows[0]?.id,
      ])
    }
  })

  test("Given brief links on the demand and one item, when the demand JSON is read, then each carries its link and the others null", async () => {
    const link = "https://docs.google.com/document/d/kajian/view"
    await su.query("UPDATE demands SET brief_url = $2 WHERE public_code = $1", [
      demandCode,
      link,
    ])
    await su.query(
      `UPDATE demand_items SET brief_url = $2 WHERE id = (
         SELECT i.id FROM demand_items i JOIN demands d ON d.id = i.demand_id
         WHERE d.public_code = $1 ORDER BY i.position DESC LIMIT 1)`,
      [demandCode, `${link}#bagian-2`],
    )
    try {
      const body = await (
        await get(`${ITB}/api/v1/tuntutan/${demandCode}`)
      ).json()
      expect(body.demand.briefUrl).toBe(link)
      expect(
        body.demand.items.map((one: { briefUrl: unknown }) => one.briefUrl),
      ).toEqual([null, `${link}#bagian-2`])
    } finally {
      await su.query(
        `UPDATE demand_items SET brief_url = NULL WHERE demand_id =
           (SELECT id FROM demands WHERE public_code = $1)`,
        [demandCode],
      )
      await su.query(
        "UPDATE demands SET brief_url = NULL WHERE public_code = $1",
        [demandCode],
      )
    }
  })

  test("drafts and other tenants are 404, the list skips drafts", async () => {
    await expectError(
      await get(`${ITB}/api/v1/tuntutan/${draftDemand}`),
      404,
      "not_found",
    )
    await expectError(
      await get(`${UGM}/api/v1/tuntutan/${demandCode}`),
      404,
      "not_found",
    )
    const body = await (await get(`${ITB}/api/v1/tuntutan`)).json()
    expect(body.demands.map((d: { code: string }) => d.code)).toEqual([
      demandCode,
    ])
    expect(piiIn(body)).toEqual([])
  })
})

describe("dashboard data", () => {
  test("JSON holds every table with metadata", async () => {
    const res = await get(`${ITB}/api/v1/data`)
    expect(res.status).toBe(200)
    expectPublic(res)
    const body = await res.json()
    expect(body.meta.source).toBe("http://itbapi.localhost/data")
    expect(body.meta.stale).toBe(false)
    expect(body.meta.firstReportAt).toBe("2026-03-02")
    expect(body.meta.suppression).toEqual({ minPublicN: 5 })
    expect(body.meta.datasets.map((d: { id: string }) => d.id)).toEqual([
      ...DATASET_IDS,
    ])
    expect(body.meta.datasets[1]).toMatchObject({
      id: "tren",
      title: "Tren Laporan Bulanan",
      columns: ["month", "received", "verified"],
      csv: "http://itbapi.localhost/api/v1/data/tren.csv",
    })
    expect(body.datasets.tren).toEqual([
      { month: "2026-10", received: 10, verified: 5 },
    ])
    expect(body.datasets.tuntutan).toContainEqual({ metric: "total", value: 1 })
    // The /data map header total
    expect(body.datasets["wilayah-total"]).toContainEqual({
      category: "all",
      status: "all",
      verified_reports: 26,
    })
    expect(body.datasets["peringkat-isu"][0]).toMatchObject({
      order: "laporan",
      code: PUBLISHED,
    })
    expect(piiIn(body)).toEqual([])
  })

  test("CSV per table, suppressed cells empty", async () => {
    const res = await get(`${ITB}/api/v1/data/wilayah.csv`)
    expect(res.status).toBe(200)
    expectPublic(res)
    expect(res.headers.get("Content-Type")).toBe(
      "text/csv; charset=utf-8; header=present",
    )
    expect(res.headers.get("Content-Disposition")).toBe(
      'attachment; filename="itbapi-wilayah.csv"',
    )
    expect(res.headers.get("Link")).toContain(
      '<http://itbapi.localhost/api/v1/data>; rel="describedby"',
    )
    const text = await res.text()
    expect(text).toContain(",verified_reports\r\n")
    const totals = await get(`${ITB}/api/v1/data/wilayah-total.csv`)
    expect(totals.status).toBe(200)
    expectPublic(totals)
    const rows = await totals.text()
    expect(rows.startsWith("category,status,verified_reports\r\n")).toBe(true)
    expect(rows).toContain("all,all,26\r\n")
  })

  test("reasons are free text, so no reason table", async () => {
    // Per-reason table removed
    expect((await get(`${ITB}/api/v1/data/alasan.csv`)).status).toBe(404)
    const body = await (await get(`${ITB}/api/v1/data`)).json()
    expect(Object.keys(body.datasets)).not.toContain("alasan")
  })

  test("a README carries the licence beside the CSVs", async () => {
    // CMP-23: saved files keep attribution
    const res = await get(`${ITB}/api/v1/data/README.txt`)
    expect(res.status).toBe(200)
    expectPublic(res)
    expect(res.headers.get("Content-Type")).toBe("text/plain; charset=utf-8")
    expect(res.headers.get("Content-Disposition")).toBe(
      'attachment; filename="itbapi-README.txt"',
    )
    expect(res.headers.get("Link")).toContain(
      '<https://creativecommons.org/licenses/by/4.0/>; rel="license"',
    )
    const text = await res.text()
    expect(text).toContain("CC BY 4.0")
    expect(text).toContain("https://creativecommons.org/licenses/by/4.0/")
    expect(text).toContain(
      m.api_attribution({
        operator: "KM itbapi",
        campus: "itbapi",
        url: "http://itbapi.localhost/data",
      }),
    )
    for (const id of DATASET_IDS) {
      expect(text).toContain(`http://itbapi.localhost/api/v1/data/${id}.csv`)
    }
    expect(text).toContain("tren.csv")
    expect(text).toContain("month, received, verified")
    expect(piiIn(text)).toEqual([])
    const json = await (await get(`${ITB}/api/v1/data`)).json()
    expect(json.meta.readme).toBe(
      "http://itbapi.localhost/api/v1/data/README.txt",
    )
    const csv = await get(`${ITB}/api/v1/data/tren.csv`)
    expect(csv.headers.get("Link")).toContain(
      '<http://itbapi.localhost/api/v1/data/README.txt>; rel="help"',
    )
  })

  test("unknown tables are 404, no snapshot is 503", async () => {
    await expectError(
      await get(`${ITB}/api/v1/data/rahasia.csv`),
      404,
      "not_found",
    )
    const res = await get(`${UGM}/api/v1/data`)
    await expectError(res.clone(), 503, "snapshot_pending")
    expect(res.headers.get("Retry-After")).toBe("900")
  })
})

describe("protocol", () => {
  test("Given a client at the API root, then every endpoint is listed on the campus origin", async () => {
    const res = await get(`${ITB}/api/v1`)
    expect(res.status).toBe(200)
    expectPublic(res)
    const base = "http://itbapi.localhost/api/v1"
    expect((await res.json()).endpoints).toEqual({
      issues: `${base}/isu`,
      issue: `${base}/isu/{code}`,
      demands: `${base}/tuntutan`,
      demand: `${base}/tuntutan/{code}`,
      data: `${base}/data`,
      dataset: `${base}/data/{dataset}.csv`,
    })
  })

  test("If-None-Match gives 304 and keeps cache headers", async () => {
    const first = await get(`${ITB}/api/v1/data/tren.csv`)
    const tag = first.headers.get("ETag") ?? ""
    const res = await get(`${ITB}/api/v1/data/tren.csv`, {
      "if-none-match": tag,
    })
    expect(res.status).toBe(304)
    expect(res.headers.get("ETag")).toBe(tag)
    expect(res.headers.get("Cache-Control")).toBe(
      "public, max-age=0, no-transform",
    )
    expect(await res.text()).toBe("")
  })

  test("HEAD answers like GET without a body", async () => {
    const res = await app.request(`${ITB}/api/v1/isu/${PUBLISHED}`, {
      method: "HEAD",
    })
    expect(res.status).toBe(200)
    expect(res.headers.get("ETag")).toMatch(/^W\//)
    expect(await res.text()).toBe("")
  })

  test("writes are 405, unknown paths stay JSON 404", async () => {
    const res = await app.request(`${ITB}/api/v1/isu`, { method: "POST" })
    await expectError(res.clone(), 405, "method_not_allowed")
    expect(res.headers.get("Allow")).toBe("GET, HEAD")
    await expectError(await get(`${ITB}/api/v1/tidak-ada`), 404, "not_found")
  })

  test("preflight allows only reads", async () => {
    const res = await app.request(`${ITB}/api/v1/data`, {
      method: "OPTIONS",
      headers: {
        origin: "https://contoh.id",
        "access-control-request-method": "GET",
      },
    })
    expect(res.status).toBe(204)
    expect(res.headers.get("Access-Control-Allow-Methods")).toBe("GET,HEAD")
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*")
  })

  test("the apex and unknown hosts have no API", async () => {
    await expectError(
      await get(`http://${apexHost()}/api/v1/data`),
      404,
      "not_found",
    )
    await expectError(
      await get("http://tidakada.localhost/api/v1/isu"),
      404,
      "not_found",
    )
  })

  test("a session cookie never makes the answer public", async () => {
    const res = await get(`${ITB}/api/v1/isu/${PUBLISHED}`, {
      cookie: "sb.session_token=x",
    })
    expect(res.status).toBe(200)
    expect(res.headers.get("Cache-Control")).toBe("private, no-store")
  })

  test("origin hits per client are limited", async () => {
    const limited = makeApp({ max: 2, windowMs: 60_000 })
    const hit = (ip: string) =>
      limited.request(`${ITB}/api/v1/isu`, { headers: { "x-client-ip": ip } })
    expect((await hit("203.0.113.5")).status).toBe(200)
    expect((await hit("203.0.113.5")).status).toBe(200)
    const res = await hit("203.0.113.5")
    await expectError(res.clone(), 429, "rate_limited")
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0)
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*")
    expect((await hit("203.0.113.6")).status).toBe(200)
  })
})
