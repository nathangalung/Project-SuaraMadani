import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { drizzle } from "drizzle-orm/node-postgres"
import {
  changeDemandState,
  createDemand,
  type DemandFields,
  type DemandTenant,
  getManagedDemand,
} from "../../app/features/demands/manage.server.ts"
import { migrate } from "../../db/migrate.ts"
import { issues } from "../../db/schema/issues.ts"
import {
  insertOrg,
  insertRegions,
  insertUser,
  resetData,
  superuserPool,
  testUrl,
} from "../../db/testing.ts"
import {
  dropJobs,
  type FullApp,
  fullApp,
  hostsChanged,
  signedIn,
} from "../../e2e/app-harness.ts"
import {
  CATEGORY_FILTERS,
  type DashboardSnapshot,
  filterKey,
  STATUS_FILTERS,
} from "../../shared/dashboard.ts"

// Own hosts, tenant cache
const ITB = "accapi.localhost"
const UGM = "accapib.localhost"
const EMPTY = "accapic.localhost"
const PUBLISHED = "ISU-2026-10-0001"
const DRAFT = "ISU-2026-10-0002"
const TAKEN = "ISU-2026-10-0003"
const FORMULA = "ISU-2026-10-0004"
const OTHER = "ISU-2026-10-0005"
const LICENSE = "https://creativecommons.org/licenses/by/4.0/"

const su = superuserPool()
const suDb = drizzle({ client: su })
let app: FullApp
let demandCode = ""
let draftDemand = ""
let citizen = ""

const url = (host: string, path: string) => `http://${host}${path}`
const get = (
  host: string,
  path: string,
  headers: Record<string, string> = {},
) => app.request(url(host, path), { headers })

// Keys that would be personal
const PII_KEYS =
  /^(email|phone|phoneNumber|userId|ipAddress|createdBy|decidedBy|name|story|point|contact|clientHash)$/i

function personal(value: unknown, path = "$"): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((one, i) => personal(one, `${path}[${i}]`))
  }
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, one]) => [
      ...(PII_KEYS.test(key) ? [`${path}.${key}`] : []),
      ...personal(one, `${path}.${key}`),
    ])
  }
  return typeof value === "string" && /\S+@\S+\.\S+/.test(value)
    ? [`${path}=${value}`]
    : []
}

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
    // Worker already hid 1-4
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

/** Counted and young raters. */
async function rank(orgId: string, count: number, ageDays: number) {
  for (let i = 0; i < count; i++) {
    const user = await insertUser(
      su,
      `peringkat-${ageDays}-${i}-${crypto.randomUUID().slice(0, 6)}@contoh.id`,
    )
    await su.query(
      `UPDATE users SET created_at = now() - make_interval(days => $2) WHERE id = $1`,
      [user, ageDays],
    )
    const { rows } = await su.query<{ id: string }>(
      "SELECT id FROM demands WHERE public_code = $1",
      [demandCode],
    )
    await su.query(
      `INSERT INTO demand_rankings (org_id, demand_id, user_id, position)
       VALUES ($1, $2, $3, 1)`,
      [orgId, rows[0]?.id, user],
    )
  }
}

beforeAll(async () => {
  await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
  await resetData(su)
  await insertRegions(su)
  const orgId = await insertOrg(su, "accapi")
  const otherId = await insertOrg(su, "accapib")
  await insertOrg(su, "accapic")
  hostsChanged([ITB, UGM, EMPTY])
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
      publicCode: FORMULA,
      title: "=HYPERLINK(1) jalan rusak",
      reportCount: 9,
      publishedAt: new Date(Date.now() - 86_400_000),
    },
    {
      ...base,
      orgId: otherId,
      number: 1,
      publicCode: OTHER,
      publishedAt: new Date(),
    },
  ])
  await su.query(
    "INSERT INTO dashboard_snapshots (org_id, data, computed_at) VALUES ($1, $2, now() - interval '5 minutes')",
    [orgId, JSON.stringify(snapshot())],
  )
  const admin = await insertUser(su, "admin.accapi@contoh.id")
  const tenant: DemandTenant = { id: orgId, host: ITB, campusCode: "ACCAPI" }
  const created = await createDemand(tenant, {
    fields: FIELDS,
    items: ["Standar waktu pemulihan", "Tangki air bantuan"],
    actorId: admin,
  })
  if (!created.ok) throw new Error(created.reason)
  demandCode = created.code
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
  app = await fullApp({ apiRateLimit: { max: 5, windowMs: 60_000 } })
  citizen = (
    await signedIn(ITB, {
      email: "warga.accapi@contoh.id",
      phone: "+6281277700001",
      name: "Warga API",
    })
  ).cookie
})

afterAll(async () => {
  await dropJobs(su, [ITB, UGM, EMPTY])
  // Later files rebuild auth
  hostsChanged([ITB, UGM, EMPTY])
  await resetData(su)
  await su.end()
})

// Fresh rate-limit bucket each call
let ipSeq = 0
const client = () => ({ "X-Client-IP": `10.9.0.${++ipSeq}` })

describe("public data API", () => {
  test("[AC-API-01] Given a published issue, when a data user reads the issue list and the issue as JSON, then both carry the CC BY 4.0 licence and no personal data", async () => {
    const list = await get(ITB, "/api/v1/isu", client())
    expect(list.status).toBe(200)
    expect(list.headers.get("Content-Type")).toStartWith("application/json")
    expect(list.headers.get("Link")).toBe(
      `<${LICENSE}>; rel="license", <http://${ITB}/isu>; rel="alternate"; type="text/html"`,
    )
    const listed = await list.json()
    expect(listed.meta.license).toBe("CC-BY-4.0")
    expect(listed.meta.attribution).toContain("Data berlisensi CC BY 4.0")
    const codes = listed.issues.map((one: { code: string }) => one.code)
    expect(codes.sort()).toEqual([PUBLISHED, FORMULA].sort())

    const one = await get(ITB, `/api/v1/isu/${PUBLISHED}`, client())
    expect(one.status).toBe(200)
    expect(one.headers.get("Link")).toBe(
      `<${LICENSE}>; rel="license", <http://${ITB}/isu/${PUBLISHED}>; rel="alternate"; type="text/html"`,
    )
    const body = await one.json()
    expect(body.meta.licenseUrl).toBe(LICENSE)
    expect(body.issue).toMatchObject({
      code: PUBLISHED,
      title: "Jalan berlubang di Dago",
      regencyName: "Kota Bandung",
    })
    expect(personal(listed)).toEqual([])
    expect(personal(body)).toEqual([])
  })

  test("[AC-API-02] Given unpublished, removed, draft and other-campus records, when the API is asked for them, then it answers 404 or 410 and never the record", async () => {
    const error = async (host: string, path: string) => {
      const res = await get(host, path, client())
      expect(res.headers.get("Cache-Control")).toBe("no-store")
      return { status: res.status, body: await res.json() }
    }
    expect(await error(ITB, `/api/v1/isu/${DRAFT}`)).toEqual({
      status: 404,
      body: { error: "not_found" },
    })
    expect(await error(ITB, `/api/v1/isu/${OTHER}`)).toEqual({
      status: 404,
      body: { error: "not_found" },
    })
    expect(await error(ITB, `/api/v1/isu/${TAKEN}`)).toEqual({
      status: 410,
      body: {
        error: "taken_down",
        takenDownAt: "2026-10-14T03:00:00.000Z",
        reason: "standard_11",
      },
    })
    expect(await error(ITB, `/api/v1/tuntutan/${draftDemand}`)).toEqual({
      status: 404,
      body: { error: "not_found" },
    })
    for (const host of ["localhost", "nobody.localhost"]) {
      const res = await get(host, "/api/v1/isu", client())
      expect(res.status).toBe(404)
      expect(res.headers.get("Cache-Control")).toBe("no-store")
    }
  })

  test("[AC-API-03] Given any website, when it calls the API, then it may read without credentials but every write method gets 405", async () => {
    const res = await get(ITB, "/api/v1/isu", {
      ...client(),
      Origin: "https://elsewhere.example",
    })
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*")
    expect(res.headers.get("Access-Control-Allow-Credentials")).toBeNull()
    expect(res.headers.get("Access-Control-Expose-Headers")).toBe("ETag,Link")
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const write = await app.request(url(ITB, "/api/v1/isu"), {
        method,
        headers: { ...client(), Origin: `http://${ITB}` },
      })
      expect(write.status).toBe(405)
      expect(write.headers.get("Allow")).toBe("GET, HEAD")
      expect(await write.json()).toEqual({ error: "method_not_allowed" })
    }
  })

  test("[AC-API-04] Given a cached API answer, when it is read anonymously, with a session or with its ETag, then the cache headers follow the public page rules", async () => {
    const res = await get(ITB, `/api/v1/isu/${PUBLISHED}`, client())
    expect(res.headers.get("Cache-Control")).toBe(
      "public, max-age=0, no-transform",
    )
    expect(res.headers.get("Cloudflare-CDN-Cache-Control")).toBe(
      "max-age=60, stale-while-revalidate=30, stale-if-error=86400",
    )
    expect(res.headers.get("Set-Cookie")).toBeNull()
    const tag = res.headers.get("ETag") ?? ""
    expect(tag).toMatch(/^W\/"/)
    const again = await get(ITB, `/api/v1/isu/${PUBLISHED}`, {
      ...client(),
      "If-None-Match": tag,
    })
    expect(again.status).toBe(304)
    expect(await again.text()).toBe("")
    const private_ = await get(ITB, `/api/v1/isu/${PUBLISHED}`, {
      ...client(),
      Cookie: citizen,
    })
    expect(private_.status).toBe(200)
    expect(private_.headers.get("Cache-Control")).toBe("private, no-store")
    expect(private_.headers.get("Cloudflare-CDN-Cache-Control")).toBeNull()
  })

  test("[AC-API-05] Given a link with tracking parameters or a lowercase code, when it is opened, then the API redirects 301 to the canonical URL before reading data", async () => {
    const tracked = await get(
      ITB,
      "/api/v1/isu?utm_source=x&kategori=program",
      client(),
    )
    expect(tracked.status).toBe(301)
    expect(tracked.headers.get("Location")).toBe("/api/v1/isu?kategori=program")
    const lower = await get(
      ITB,
      `/api/v1/isu/${PUBLISHED.toLowerCase()}`,
      client(),
    )
    expect(lower.status).toBe(301)
    expect(lower.headers.get("Location")).toBe(`/api/v1/isu/${PUBLISHED}`)
    expect(lower.headers.get("Cache-Control")).toBe(
      "public, max-age=0, no-transform",
    )
  })

  test("[AC-API-06] Given one client over its request budget, when it calls again in the same window, then it gets 429 with Retry-After while another client is served", async () => {
    const busy = { "X-Client-IP": "10.8.8.8" }
    for (let i = 0; i < 5; i++) {
      expect((await get(ITB, "/api/v1", busy)).status).toBe(200)
    }
    const over = await get(ITB, "/api/v1", busy)
    expect(over.status).toBe(429)
    expect(Number(over.headers.get("Retry-After"))).toBeGreaterThan(0)
    expect(over.headers.get("Cache-Control")).toBe("no-store")
    expect(await over.json()).toEqual({ error: "rate_limited" })
    expect(
      (await get(ITB, "/api/v1", { "X-Client-IP": "10.8.8.9" })).status,
    ).toBe(200)
  })

  test("[AC-API-07] Given a dashboard snapshot, when a data user reads /api/v1/data and a table CSV, then the CSV has a stable URL, a download name, the licence and the same rows as the JSON", async () => {
    const res = await get(ITB, "/api/v1/data", client())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.meta.license).toBe("CC-BY-4.0")
    expect(body.meta.datasets).toHaveLength(13)
    const tren = body.meta.datasets.find(
      (one: { id: string }) => one.id === "tren",
    )
    expect(tren.csv).toBe(`http://${ITB}/api/v1/data/tren.csv`)
    const csv = await get(ITB, "/api/v1/data/tren.csv", client())
    expect(csv.status).toBe(200)
    expect(csv.headers.get("Content-Type")).toBe(
      "text/csv; charset=utf-8; header=present",
    )
    expect(csv.headers.get("Content-Disposition")).toBe(
      'attachment; filename="accapi-tren.csv"',
    )
    expect(csv.headers.get("Link")).toContain(`<${LICENSE}>; rel="license"`)
    expect(csv.headers.get("Link")).toContain(
      `<http://${ITB}/api/v1/data>; rel="describedby"`,
    )
    expect(await csv.text()).toBe("month,received,verified\r\n2026-10,10,5\r\n")
    expect(body.datasets.tren).toEqual([
      { month: "2026-10", received: 10, verified: 5 },
    ])
    const readme = await get(ITB, "/api/v1/data/README.txt", client())
    expect(readme.status).toBe(200)
    expect(await readme.text()).toContain(LICENSE)
  })

  test("[AC-API-08] Given a campus without a dashboard snapshot yet, when its tables are read, then the API answers 503 snapshot_pending instead of a table of zeros", async () => {
    const res = await get(EMPTY, "/api/v1/data/ringkasan.csv", client())
    expect(res.status).toBe(503)
    expect(res.headers.get("Retry-After")).toBe("900")
    expect(await res.json()).toEqual({ error: "snapshot_pending" })
  })

  test("[AC-API-10] Given an issue title that starts like a formula, when the ranking CSV is downloaded, then the cell starts with a quote while the JSON keeps the title", async () => {
    const csv = await (
      await get(ITB, "/api/v1/data/peringkat-isu.csv", client())
    ).text()
    expect(csv).toContain(`'=HYPERLINK(1) jalan rusak`)
    const body = await (await get(ITB, "/api/v1/data", client())).json()
    const titles = body.datasets["peringkat-isu"].map(
      (row: { title: string }) => row.title,
    )
    expect(titles).toContain("=HYPERLINK(1) jalan rusak")
  })

  test("[AC-API-11] Given a search shorter than three characters, when the issue list is searched, then the API refuses it with 400 short_query", async () => {
    const res = await get(ITB, "/api/v1/isu?q=ab", client())
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: "short_query" })
  })

  test("[AC-API-12] Given a tuntutan ranked by young and old accounts, when its JSON is read, then its citizen place appears only once ten counted rankers exist", async () => {
    const orgId = (
      await su.query<{ id: string }>(
        "SELECT id FROM organizations WHERE host = $1",
        [ITB],
      )
    ).rows[0]?.id
    if (!orgId) throw new Error("no org")
    await rank(orgId, 9, 30)
    await rank(orgId, 3, 1)
    const nine = await (
      await get(ITB, `/api/v1/tuntutan/${demandCode}`, client())
    ).json()
    expect(nine.demand.ranking).toMatchObject({ rankers: 9, shown: false })
    expect(nine.demand.rank).toEqual({ place: null, rankers: 9 })
    await rank(orgId, 1, 30)
    const ten = await (
      await get(ITB, `/api/v1/tuntutan/${demandCode}`, client())
    ).json()
    expect(ten.demand.ranking).toMatchObject({ rankers: 10, shown: true })
    expect(ten.demand.rank).toEqual({ place: 1, rankers: 10 })
    const list = await (await get(ITB, "/api/v1/tuntutan", client())).json()
    const row = list.demands.find(
      (one: { code: string }) => one.code === demandCode,
    )
    expect(row.rank).toEqual({ place: 1, rankers: 10 })
    expect(personal(ten)).toEqual([])
    expect(personal(list)).toEqual([])
  })
})
