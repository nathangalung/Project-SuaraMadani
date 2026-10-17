import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { migrate } from "../../../db/migrate.ts"
import {
  insertOrg,
  insertRegions,
  resetData,
  superuserPool,
  testUrl,
} from "../../../db/testing.ts"
import { CATEGORY_IDS } from "../../../shared/categories.ts"
import { GOVERNMENT_STATUSES } from "../../../shared/status.ts"
import {
  campusHref,
  type NationalRow,
  readNational,
  shapeNational,
} from "./national.server.ts"

const AT = new Date("2026-10-15T03:00:00Z")

function row(
  dimension: NationalRow["dimension"],
  key: string,
  issues: number | null,
  extra: Partial<NationalRow> = {},
): NationalRow {
  return {
    dimension,
    key,
    received: null,
    issues,
    issueReports: issues,
    demands: null,
    computedAt: AT,
    ...extra,
  }
}

const orgs = [
  {
    id: "b",
    name: "KM UGM",
    campusName: "Universitas Gadjah Mada",
    host: "ugm.localhost",
  },
  {
    id: "a",
    name: "KM ITB",
    campusName: "Institut Teknologi Bandung",
    host: "itb.localhost",
  },
  {
    id: "c",
    name: "BEM UI",
    campusName: "Universitas Indonesia",
    host: "ui.localhost",
  },
]

const provinces = new Map([
  ["32", "Jawa Barat"],
  ["34", "Daerah Istimewa Yogyakarta"],
  ["31", "DKI Jakarta"],
])

const rows: NationalRow[] = [
  row("campus", "a", 40, { received: 180, issueReports: 92, demands: 3 }),
  row("campus", "b", null, { received: 40, issueReports: 9, demands: 0 }),
  row("category", "program", 30),
  row("category", "bencana", null),
  row("province", "34", null),
  row("province", "32", 25),
  row("province", "31", 12),
  row("status", "confirmed_resolved", 6),
  row("total", "all", 44, { received: 220, issueReports: 101, demands: 3 }),
  // Tuntutan are public: exact
  row("demand", "national", null, { demands: 1 }),
  row("demand", "regional", null, { demands: 2 }),
  row("demand", "active", null, { demands: 2 }),
  row("demand", "fulfilled", null, { demands: 1 }),
  row("demand", "items", null, { demands: 9 }),
  row("demand", "items_fulfilled", null, { demands: 4 }),
]

describe("shapeNational", () => {
  const view = shapeNational({
    rows,
    orgs,
    provinces,
    now: new Date(AT.getTime() + 10 * 60_000),
    href: (host) => `https://${host}`,
  })

  test("campuses sort by campus name, never by count", () => {
    expect(view.campuses.map((c) => c.id)).toEqual(["a", "b", "c"])
    expect(view.campuses[0]).toMatchObject({
      href: "https://itb.localhost",
      received: 180,
      issues: 40,
      demands: 3,
    })
    expect(view.campuses[1]?.demands).toBe(0)
  })

  test("a campus newer than the refresh has no data yet", () => {
    expect(view.campuses[2]).toMatchObject({
      received: undefined,
      issues: undefined,
      demands: undefined,
    })
  })

  test("every category and status is listed, absent is zero", () => {
    expect(view.categories.map((c) => c.id)).toEqual([...CATEGORY_IDS])
    expect(view.categories.find((c) => c.id === "bansos")?.issues).toBe(0)
    expect(view.categories.find((c) => c.id === "bencana")?.issues).toBeNull()
    expect(view.statuses).toHaveLength(GOVERNMENT_STATUSES.length)
    expect(view.statuses.find((s) => s.id === "closed")?.issues).toBe(0)
  })

  test("provinces: exact counts first, hidden ones last", () => {
    expect(view.provinces.map((p) => p.name)).toEqual([
      "Jawa Barat",
      "DKI Jakarta",
      "Daerah Istimewa Yogyakarta",
    ])
  })

  test("totals, resolved count and freshness", () => {
    expect(view.total).toEqual({
      campuses: 3,
      received: 220,
      issues: 44,
      issueReports: 101,
      resolved: 6,
    })
    expect(view.demands).toEqual({
      total: 3,
      national: 1,
      regional: 2,
      active: 2,
      fulfilled: 1,
      items: 9,
      itemsFulfilled: 4,
    })
    expect(view.computedAt).toBe(AT.toISOString())
    expect(view.nextAt).toBe(new Date(AT.getTime() + 15 * 60_000).toISOString())
    expect(view.stale).toBe(false)
  })

  test("stale after an hour", () => {
    const late = shapeNational({
      rows,
      orgs,
      provinces,
      now: new Date(AT.getTime() + 61 * 60_000),
      href: (host) => host,
    })
    expect(late.stale).toBe(true)
  })

  test("a hidden network total stays hidden", () => {
    const small = shapeNational({
      rows: [row("total", "all", null, { received: null, issueReports: null })],
      orgs,
      provinces,
      now: AT,
      href: (host) => host,
    })
    expect(small.total.received).toBeNull()
    expect(small.total.issues).toBeNull()
    // No demand rows: zeros
    expect(small.demands.total).toBe(0)
  })
})

describe("campusHref", () => {
  test("production is https on the host", () => {
    expect(
      campusHref("itb.suaramadani.id", { production: true, port: "8443" }),
    ).toBe("https://itb.suaramadani.id")
  })

  test("dev keeps the apex port", () => {
    expect(
      campusHref("itb.localhost", { production: false, port: "5173" }),
    ).toBe("http://itb.localhost:5173")
    expect(campusHref("itb.localhost", { production: false, port: "" })).toBe(
      "http://itb.localhost",
    )
  })
})

describe("readNational", () => {
  const su = superuserPool()

  beforeAll(async () => {
    await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
    await resetData(su)
    await insertRegions(su)
    await insertOrg(su, "nreada")
  })

  afterAll(async () => {
    await su.query("REFRESH MATERIALIZED VIEW public.national_aggregates")
    await resetData(su)
    await su.query("REFRESH MATERIALIZED VIEW public.national_aggregates")
    await su.end()
  })

  test("before the first refresh the page is empty", async () => {
    await su.query(
      "REFRESH MATERIALIZED VIEW public.national_aggregates WITH NO DATA",
    )
    expect(await readNational({ port: "" })).toEqual({ kind: "empty" })
  })

  test("reads the view as sm_app, campus names live", async () => {
    await su.query("REFRESH MATERIALIZED VIEW public.national_aggregates")
    const view = await readNational({ port: "" })
    if (view.kind !== "ready") throw new Error("not ready")
    expect(view.campuses).toEqual([
      expect.objectContaining({
        name: "KM nreada",
        received: 0,
        issues: 0,
        href: "http://nreada.localhost",
      }),
    ])
    expect(view.total.campuses).toBe(1)
  })

  test("public tuntutan are exact, drafts never", async () => {
    const { rows: orgRows } = await su.query<{ id: string }>(
      "SELECT id FROM organizations WHERE slug = 'nreada'",
    )
    const orgId = orgRows[0]?.id
    const insert = (number: number, state: string, scope: string) =>
      su.query<{ id: string }>(
        `INSERT INTO demands (org_id, year, number, public_code, scope, province_code, title, body, summary, target, raised_on, state, progress, published_at)
         VALUES ($1, 2026, $2, $3, $4, $5, 'Judul tuntutan uji', 'Isi tuntutan uji coba', 'Ringkasan tuntutan uji', 'Lembaga', '2026-10-01', $6, $7, $8)
         RETURNING id`,
        [
          orgId,
          number,
          `TUN-NREADA-26-000${number}`,
          scope,
          scope === "regional" ? "32" : null,
          state,
          number === 1 ? "fulfilled" : "not_fulfilled",
          state === "draft" ? null : AT,
        ],
      )
    const first = await insert(1, "published", "national")
    await insert(2, "published", "regional")
    await insert(3, "draft", "regional")
    await su.query(
      `INSERT INTO demand_items (org_id, demand_id, position, body, response_status, fulfilment_status)
       VALUES ($1, $2, 0, 'Sub-tuntutan uji', 'responded', 'fulfilled')`,
      [orgId, first.rows[0]?.id],
    )
    try {
      await su.query("REFRESH MATERIALIZED VIEW public.national_aggregates")
      const view = await readNational({ port: "" })
      if (view.kind !== "ready") throw new Error("not ready")
      expect(view.demands).toEqual({
        total: 2,
        national: 1,
        regional: 1,
        active: 1,
        fulfilled: 1,
        items: 1,
        itemsFulfilled: 1,
      })
      expect(view.campuses[0]?.demands).toBe(2)
    } finally {
      await su.query("DELETE FROM demands")
    }
  })
})
