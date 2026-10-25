import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { migrate } from "../../../db/migrate.ts"
import {
  insertOrg,
  insertRegions,
  insertUser,
  resetData,
  superuserPool,
  testUrl,
} from "../../../db/testing.ts"
import { cleanBriefPath } from "../../../server/files.server.ts"
import { jakartaIsoDate } from "../../../shared/format.ts"
import {
  demandOverview,
  demandProvinces,
  demandScorecard,
  getDemandCard,
  getDemandPage,
  listPublishedDemands,
  publicBriefFile,
} from "./demands.server.ts"
import {
  changeDemandState,
  createDemand,
  type DemandFields,
  type DemandTenant,
  getManagedDemand,
  linkIssue,
  publishBrief,
  recordItemUpdate,
  uploadBrief,
} from "./manage.server.ts"

const su = superuserPool()
let itb: DemandTenant
let ugm: DemandTenant
let admin = ""
let filesDir = ""

const REGIONAL: DemandFields = {
  scope: "regional",
  provinceCode: "32",
  regencyCode: "32.73",
  category: "infrastruktur_transportasi",
  title: "Standar layanan air bersih di Kota Bandung",
  body: "Kami menuntut standar waktu pemulihan suplai air bersih saat gangguan.",
  summary: "Waktu pemulihan suplai air dan kewajiban tangki air bantuan.",
  target: "Pemerintah Kota Bandung",
  raisedOn: "2026-07-30",
}

const NATIONAL: DemandFields = {
  ...REGIONAL,
  scope: "national",
  provinceCode: null,
  regencyCode: null,
  title: "Transparansi data penerima bantuan sosial nasional",
  summary: "Data penerima bantuan sosial dibuka per desa secara tersamarkan.",
  target: "Kementerian Sosial",
}

// Publish day, insert order
const SOURCE = {
  occurredOn: jakartaIsoDate(new Date()),
  note: "Pemerintah kota menerbitkan surat edaran standar layanan.",
  sourceText: "Surat edaran wali kota",
  sourceUrl: null,
}

async function make(
  fields: DemandFields,
  options: { publish?: boolean; tenant?: DemandTenant } = {},
): Promise<string> {
  const tenant = options.tenant ?? itb
  const created = await createDemand(tenant, {
    fields,
    items: ["Standar waktu pemulihan", "Tangki air bantuan"],
    actorId: admin,
  })
  if (!created.ok) throw new Error(created.reason)
  if (options.publish !== false) {
    const demand = await getManagedDemand(tenant.id, created.code)
    const published = await changeDemandState(tenant, {
      code: created.code,
      action: "publish",
      version: demand?.version ?? 0,
      note: null,
      actorId: admin,
    })
    if (!published.ok) throw new Error(published.reason)
  }
  return created.code
}

async function fulfilFirst(code: string) {
  const item = (await getManagedDemand(itb.id, code))?.items[0]
  if (!item) throw new Error("item")
  await recordItemUpdate(itb, {
    code,
    itemId: item.id,
    version: item.version,
    to: { response: "responded", fulfilment: "fulfilled" },
    ...SOURCE,
    actorId: admin,
  })
}

beforeAll(async () => {
  await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
  await resetData(su)
  await insertRegions(su)
  await su.query(
    "INSERT INTO regions (code, parent_code, level, name) VALUES ('34', NULL, 1, 'Daerah Istimewa Yogyakarta') ON CONFLICT DO NOTHING",
  )
  itb = {
    id: await insertOrg(su, "itb"),
    host: "itb.localhost",
    campusCode: "ITB",
  }
  ugm = {
    id: await insertOrg(su, "ugm"),
    host: "ugm.localhost",
    campusCode: "UGM",
  }
  admin = await insertUser(su, "admin.publik@contoh.id")
  filesDir = await mkdtemp(join(tmpdir(), "sb-public-"))
})

beforeEach(async () => {
  await su.query("DELETE FROM demands")
  await su.query("DELETE FROM issues")
  await su.query("DELETE FROM org_counters")
})

afterAll(async () => {
  await rm(filesDir, { recursive: true, force: true })
  await resetData(su)
  await su.end()
})

describe("listPublishedDemands", () => {
  test("drafts and other tenants never show", async () => {
    await make(REGIONAL, { publish: false })
    await make(NATIONAL, { tenant: ugm })
    const published = await make(NATIONAL)
    const result = await listPublishedDemands(itb.id, {})
    if (result.kind !== "results") throw new Error(result.kind)
    expect(result.demands.map((demand) => demand.code)).toEqual([published])
    expect(await getDemandPage(itb.id, "TUN-ITB-26-0001")).toBeNull()
  })

  test("filters by scope, province, status, category and search", async () => {
    const regional = await make(REGIONAL)
    const national = await make({ ...NATIONAL, category: "bantuan_sosial" })
    await fulfilFirst(regional)
    const codes = async (query: Record<string, string>) => {
      const result = await listPublishedDemands(itb.id, query)
      if (result.kind !== "results") throw new Error(result.kind)
      return result.demands.map((demand) => demand.code)
    }
    expect(await codes({ lingkup: "nasional" })).toEqual([national])
    expect(await codes({ lingkup: "daerah" })).toEqual([regional])
    expect(await codes({ provinsi: "32" })).toEqual([regional])
    expect(await codes({ status: "partially_fulfilled" })).toEqual([regional])
    expect(await codes({ status: "not_fulfilled" })).toEqual([national])
    expect(await codes({ q: "bantuan sosial" })).toEqual([national])
    expect(await codes({ kategori: "bantuan_sosial" })).toEqual([national])
    expect(await codes({ kategori: "kesehatan" })).toEqual([])
    // Unknown category is ignored
    expect(await codes({ kategori: "bukan'kategori" })).toHaveLength(2)
    expect(await listPublishedDemands(itb.id, { q: "ai" })).toEqual({
      kind: "short_query",
    })
    expect(await listPublishedDemands(itb.id, { kursor: "x" })).toEqual({
      kind: "bad_cursor",
    })
  })

  test("rows carry derived progress and region names", async () => {
    const code = await make(REGIONAL)
    await fulfilFirst(code)
    const result = await listPublishedDemands(itb.id, {})
    if (result.kind !== "results") throw new Error(result.kind)
    const [row] = result.demands
    expect(row?.provinceName).toBe("Jawa Barat")
    expect(row?.regencyName).toBe("Kota Bandung")
    expect(row?.progress).toMatchObject({
      total: 2,
      fulfilled: 1,
      responded: 1,
      status: "partially_fulfilled",
    })
    expect(row?.briefs).toBe(0)
    expect(row?.issueCount).toBe(0)
  })
})

describe("demandProvinces", () => {
  test("provinces with public tuntutan, plus the one chosen", async () => {
    await make(REGIONAL)
    await make(
      { ...REGIONAL, provinceCode: "34", regencyCode: null },
      {
        publish: false,
      },
    )
    const jabar = { code: "32", name: "Jawa Barat" }
    expect(await demandProvinces(itb.id)).toEqual([jabar])
    expect(await demandProvinces(itb.id, "34")).toEqual([
      { code: "34", name: "Daerah Istimewa Yogyakarta" },
      jabar,
    ])
    expect(await demandProvinces(itb.id, "32.73")).toEqual([jabar])
    expect(await demandProvinces(itb.id, "99")).toEqual([jabar])
  })
})

describe("demandScorecard", () => {
  test("counts public demands per derived status", async () => {
    const first = await make(REGIONAL)
    await make(NATIONAL)
    await make(NATIONAL, { publish: false })
    await fulfilFirst(first)
    expect(await demandScorecard(itb.id)).toEqual({
      total: 2,
      counts: {
        not_fulfilled: 1,
        partially_fulfilled: 1,
        fulfilled: 0,
        rejected: 0,
      },
    })
  })
})

describe("demandOverview", () => {
  test("live counts, regional cells and lists, drafts never", async () => {
    const first = await make(REGIONAL)
    const second = await make({
      ...REGIONAL,
      title: "Halte bus layak di Bandung",
    })
    const national = await make(NATIONAL)
    await make({ ...REGIONAL, provinceCode: "34", regencyCode: null })
    await make(REGIONAL, { publish: false })
    await make(NATIONAL, { tenant: ugm })
    await fulfilFirst(first)
    // Both items met, then closed
    const demand = await getManagedDemand(itb.id, second)
    for (const item of demand?.items ?? []) {
      await recordItemUpdate(itb, {
        code: second,
        itemId: item.id,
        version: item.version,
        to: { response: "responded", fulfilment: "fulfilled" },
        ...SOURCE,
        actorId: admin,
      })
    }
    const done = await getManagedDemand(itb.id, second)
    await changeDemandState(itb, {
      code: second,
      action: "close",
      version: done?.version ?? 0,
      note: "Ditutup karena semua sub-tuntutan dipenuhi.",
      actorId: admin,
    })
    const overview = await demandOverview(itb.id)
    expect(overview.counts).toEqual({
      total: 4,
      national: 1,
      regional: 3,
      active: 3,
      fulfilled: 1,
      items: 8,
      itemsFulfilled: 3,
    })
    expect(overview.provinces).toEqual({
      "32": {
        not_fulfilled: 0,
        partially_fulfilled: 1,
        fulfilled: 1,
        rejected: 0,
      },
      "34": {
        not_fulfilled: 1,
        partially_fulfilled: 0,
        fulfilled: 0,
        rejected: 0,
      },
    })
    expect(overview.national).toEqual([
      {
        code: national,
        title: NATIONAL.title,
        state: "published",
        status: "not_fulfilled",
      },
    ])
    // Newest first, ordered marks
    expect(overview.latest.map((row) => row.code)).toEqual([
      "TUN-ITB-26-0004",
      national,
      second,
    ])
    const regional = overview.latest[0]
    expect(regional?.provinceName).toBe("Daerah Istimewa Yogyakarta")
    expect(regional?.marks).toEqual(["not_fulfilled", "not_fulfilled"])
    expect(regional?.subs).toHaveLength(2)
    expect(overview.latest[2]?.state).toBe("closed")
    expect(overview.latest[2]?.progress.status).toBe("fulfilled")
    const empty = await demandOverview(ugm.id)
    expect(empty.counts.total).toBe(1)
    expect(empty.provinces).toEqual({})
  })
})

describe("getDemandPage", () => {
  test("items, events, published issues and published briefs", async () => {
    const code = await make(REGIONAL)
    await fulfilFirst(code)
    await su.query(
      `INSERT INTO issues (org_id, year, number, public_code, title, summary, category_id, subcategory_id, province_code, regency_code, report_count, published_at)
       VALUES ($1, 2026, 1, 'ISU-2026-10-0001', 'Air bersih mati dua minggu', 'Suplai air bersih tidak mengalir di tiga kelurahan.', 'program', 'program.air', '32', '32.73', 1, now())`,
      [itb.id],
    )
    await linkIssue(itb, {
      code,
      issueCode: "ISU-2026-10-0001",
      actorId: admin,
    })
    const item = (await getManagedDemand(itb.id, code))?.items[1]
    if (!item) throw new Error("item")
    await uploadBrief(
      itb,
      {
        code,
        itemId: item.id,
        bytes: new TextEncoder().encode("%PDF-1.4\n"),
        actorId: admin,
      },
      { filesDir },
    )
    const pending = await getDemandPage(itb.id, code)
    expect(pending?.items[1]?.brief).toBeNull()
    const briefId =
      (await getManagedDemand(itb.id, code))?.items[1]?.briefs[0]?.id ?? ""
    // Stripped copy from the scan
    const clean = cleanBriefPath(filesDir, itb.id, briefId)
    await mkdir(dirname(clean), { recursive: true })
    await writeFile(clean, "%PDF-1.4\n")
    expect(await publicBriefFile(itb.id, code, briefId, filesDir)).toBeNull()
    await su.query(
      "UPDATE policy_briefs SET status = 'clean', scanned_at = now()",
    )
    await publishBrief(itb, { code, briefId, actorId: admin })
    const page = await getDemandPage(itb.id, code)
    expect(page?.items.map((row) => [row.number, row.fulfilment])).toEqual([
      [1, "fulfilled"],
      [2, "not_fulfilled"],
    ])
    expect(page?.items[1]?.brief?.url).toBe(
      `/tuntutan/${code}/dokumen/${briefId}.pdf`,
    )
    expect(page?.events.map((event) => [event.action, event.item])).toEqual([
      ["publish", null],
      ["status", 1],
      ["brief", 2],
    ])
    expect(page?.issues).toEqual([
      { code: "ISU-2026-10-0001", title: "Air bersih mati dua minggu" },
    ])
    expect(
      (await publicBriefFile(itb.id, code, briefId, filesDir))?.itemNumber,
    ).toBe(2)
    expect(await publicBriefFile(ugm.id, code, briefId, filesDir)).toBeNull()
    // Unpublished issue drops out
    await su.query("UPDATE issues SET published_at = NULL")
    expect((await getDemandPage(itb.id, code))?.issues).toEqual([])
  })

  test("closed stays public, card for OG", async () => {
    const code = await make(NATIONAL)
    const demand = await getManagedDemand(itb.id, code)
    await changeDemandState(itb, {
      code,
      action: "close",
      version: demand?.version ?? 0,
      note: "Ditutup karena digabung dengan tuntutan lain.",
      actorId: admin,
    })
    const page = await getDemandPage(itb.id, code)
    expect(page?.state).toBe("closed")
    expect(await getDemandCard(itb.id, code)).toMatchObject({
      title: NATIONAL.title,
      scope: "national",
      provinceName: null,
    })
  })
})

describe("listPublishedDemands paging", () => {
  const cursor = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url")

  test("Given more than a page, when the next cursor is followed, then the rest follows without overlap", async () => {
    const codes: string[] = []
    for (let i = 0; i < 21; i++) codes.push(await make(NATIONAL))
    const first = await listPublishedDemands(itb.id, {})
    if (first.kind !== "results") throw new Error(first.kind)
    expect(first.page).toBe(1)
    expect(first.demands).toHaveLength(20)
    expect(first.nextCursor).not.toBeNull()
    const second = await listPublishedDemands(itb.id, {
      kursor: first.nextCursor ?? "",
    })
    if (second.kind !== "results") throw new Error(second.kind)
    expect(second.page).toBe(2)
    expect(second.nextCursor).toBeNull()
    const seen = [...first.demands, ...second.demands].map((row) => row.code)
    // Newest publish first
    expect(seen).toEqual([...codes].reverse())
  })

  test("a tampered cursor is refused", async () => {
    const key = "2026-10-01T03:00:00.000000Z"
    const id = "0190a000-0000-7000-8000-000000000001"
    for (const value of [
      [1, key, id],
      [51, key, id],
      [2, "kemarin", id],
      [2, "2026-13-45T99:99:99.000000Z", id],
      [2, key, "bukan-uuid"],
      [2, key],
      { page: 2 },
    ]) {
      expect(
        await listPublishedDemands(itb.id, { kursor: cursor(value) }),
      ).toEqual({ kind: "bad_cursor" })
    }
    const fine = await listPublishedDemands(itb.id, {
      kursor: cursor([2, key, id]),
    })
    expect(fine).toMatchObject({ kind: "results", page: 2, demands: [] })
  })
})
