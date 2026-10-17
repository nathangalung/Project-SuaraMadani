import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test"
import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/node-postgres"
import { migrate } from "../../../db/migrate.ts"
import { issues } from "../../../db/schema/issues.ts"
import { reports } from "../../../db/schema/reports.ts"
import {
  insertOrg,
  insertRegions,
  insertUser,
  reportValues,
  resetData,
  superuserPool,
  testUrl,
} from "../../../db/testing.ts"
import {
  decodeCursor,
  encodeCursor,
  getIssuePage,
  getPublishedIssue,
  ISSUE_PAGE_SIZE,
  listIssueRanking,
  listPublishedIssues,
  listShowcases,
  RANKING_SIZE,
  SHOWCASE_SIZE,
} from "./issues.server.ts"
import { createSlots } from "./slots.ts"

const su = superuserPool()
const suDb = drizzle({ client: su })
let orgA = ""
let orgB = ""
let counter = 0

async function seedIssue(
  overrides: Partial<typeof issues.$inferInsert> = {},
): Promise<string> {
  counter++
  const code = `ISU-ITB-26-${String(counter).padStart(4, "0")}`
  await suDb.insert(issues).values({
    orgId: orgA,
    year: 2026,
    number: counter,
    publicCode: code,
    title: "Jalan berlubang di Dago",
    summary: "Warga melaporkan lubang besar di jalan utama.",
    categoryId: "program",
    subcategoryId: "program.infrastruktur",
    provinceCode: "32",
    regencyCode: "32.73",
    reportCount: 1,
    publishedAt: new Date(Date.UTC(2026, 9, 1, 0, counter)),
    ...overrides,
  })
  return code
}

beforeAll(async () => {
  await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
  await resetData(su)
  await insertRegions(su)
  orgA = await insertOrg(su, "itb")
  orgB = await insertOrg(su, "ugm")
})

beforeEach(async () => {
  counter = 0
  await su.query("DELETE FROM issues")
})

afterAll(async () => {
  await resetData(su)
  await su.end()
})

describe("getPublishedIssue", () => {
  test("returns the public fields with region names", async () => {
    const code = await seedIssue({ districtCode: "32.73.02" })
    const issue = await getPublishedIssue(orgA, code)
    expect(issue).toMatchObject({
      code,
      title: "Jalan berlubang di Dago",
      regencyName: "Kota Bandung",
      provinceName: "Jawa Barat",
      districtName: "Coblong",
      verificationLabel: "unverified",
      advocacyStatus: "monitoring",
      govStatus: "awaiting_response",
      reportCount: 1,
      version: 1,
    })
    expect(issue?.publishedAt).toBeInstanceOf(Date)
  })

  test("an unpublished issue is not found", async () => {
    const code = await seedIssue({ publishedAt: null })
    expect(await getPublishedIssue(orgA, code)).toBeNull()
  })

  test("another tenant's issue is not found", async () => {
    const code = await seedIssue()
    expect(await getPublishedIssue(orgB, code)).toBeNull()
  })
})

describe("listPublishedIssues", () => {
  test("lists only published issues, newest first", async () => {
    const first = await seedIssue()
    await seedIssue({ publishedAt: null })
    const third = await seedIssue()
    const result = await listPublishedIssues(orgA, {})
    if (result.kind !== "results") throw new Error(result.kind)
    expect(result.issues.map((i) => i.code)).toEqual([third, first])
    expect(result.nextCursor).toBeNull()
  })

  test("another tenant sees none", async () => {
    await seedIssue()
    const result = await listPublishedIssues(orgB, {})
    expect(result).toMatchObject({ kind: "results", issues: [] })
  })

  test("filters by category, subcategory, status and region", async () => {
    const school = await seedIssue({
      subcategoryId: "program.pendidikan",
      govStatus: "responded",
      districtCode: "32.73.02",
    })
    await seedIssue({ categoryId: "bencana", subcategoryId: "bencana.banjir" })
    const codes = async (query: Record<string, string>) => {
      const result = await listPublishedIssues(orgA, query)
      if (result.kind !== "results") throw new Error(result.kind)
      return result.issues.map((i) => i.code)
    }
    expect(await codes({ kategori: "program.pendidikan" })).toEqual([school])
    expect(await codes({ kategori: "bencana" })).toHaveLength(1)
    expect(await codes({ status: "responded" })).toEqual([school])
    expect(await codes({ wilayah: "32.73.02" })).toEqual([school])
    expect(await codes({ wilayah: "32" })).toHaveLength(2)
  })

  test("a query under 3 characters runs no search", async () => {
    await seedIssue()
    expect(await listPublishedIssues(orgA, { q: "ab" })).toEqual({
      kind: "short_query",
    })
  })

  test("search matches Indonesian words in title and summary", async () => {
    const hole = await seedIssue()
    await seedIssue({
      title: "Banjir di Cibaduyut",
      summary: "Air setinggi lutut.",
    })
    const result = await listPublishedIssues(orgA, { q: "lubang" })
    if (result.kind !== "results") throw new Error(result.kind)
    expect(result.issues.map((i) => i.code)).toEqual([hole])
  })

  test("search also finds issues by region name", async () => {
    await su.query(
      `INSERT INTO regions (code, parent_code, level, name) VALUES
         ('34', NULL, 1, 'Daerah Istimewa Yogyakarta'),
         ('34.71', '34', 2, 'Kota Yogyakarta') ON CONFLICT DO NOTHING`,
    )
    const bandung = await seedIssue()
    const jogja = await seedIssue({ provinceCode: "34", regencyCode: "34.71" })
    const city = await listPublishedIssues(orgA, { q: "bandung" })
    if (city.kind !== "results") throw new Error(city.kind)
    expect(city.issues.map((i) => i.code)).toEqual([bandung])
    const province = await listPublishedIssues(orgA, { q: "Yogyakarta" })
    if (province.kind !== "results") throw new Error(province.kind)
    expect(province.issues.map((i) => i.code)).toEqual([jogja])
    // Wildcards are literal text
    const percent = await listPublishedIssues(orgA, { q: "%%%" })
    if (percent.kind !== "results") throw new Error(percent.kind)
    expect(percent.issues).toEqual([])
  })

  test("search over 5000 issues stays under 50 ms", async () => {
    // Long summaries, every row checked
    await su.query(
      `INSERT INTO issues (org_id, year, number, public_code, title, summary,
         category_id, subcategory_id, province_code, regency_code, published_at)
       SELECT $1, 2026, g, 'ISU-ITB-26-' || g,
         (SELECT string_agg(w[1 + (g * 7 + k * 13) % 30], ' ') FROM generate_series(1, 6) k),
         (SELECT string_agg(w[1 + (g * 11 + k * 17) % 30], ' ') FROM generate_series(1, 60) k),
         'program', 'program.infrastruktur', '32', '32.73', now() - make_interval(mins => g)
       FROM generate_series(1, 5000) g, (SELECT string_to_array($2, ' ') w) words`,
      [
        orgA,
        "jalan rusak banjir sekolah puskesmas bantuan sosial air bersih listrik padam harga beras naik guru honorer jembatan putus sampah menumpuk drainase tersumbat longsor desa kecamatan pelayanan lambat antrean panjang obat kosong",
      ],
    )
    await su.query("ANALYZE issues")
    const timings: number[] = []
    for (let i = 0; i < 3; i++) {
      const start = performance.now()
      const result = await listPublishedIssues(orgA, { q: "kebakaran gedung" })
      timings.push(performance.now() - start)
      expect(result).toMatchObject({ kind: "results", issues: [] })
    }
    expect(Math.min(...timings)).toBeLessThan(50)
  })

  test("search is refused when both slots are busy", async () => {
    const slots = createSlots(0)
    expect(
      await listPublishedIssues(orgA, { q: "lubang" }, { searchSlots: slots }),
    ).toEqual({ kind: "busy" })
  })

  test("keyset pages hold every issue once", async () => {
    const total = ISSUE_PAGE_SIZE + 5
    for (let i = 0; i < total; i++) await seedIssue()
    const page1 = await listPublishedIssues(orgA, { urut: "aktivitas" })
    if (page1.kind !== "results") throw new Error(page1.kind)
    expect(page1.issues).toHaveLength(ISSUE_PAGE_SIZE)
    expect(page1.page).toBe(1)
    expect(page1.nextCursor).not.toBeNull()
    const page2 = await listPublishedIssues(orgA, {
      urut: "aktivitas",
      kursor: page1.nextCursor ?? "",
    })
    if (page2.kind !== "results") throw new Error(page2.kind)
    expect(page2.page).toBe(2)
    expect(page2.issues).toHaveLength(5)
    expect(page2.nextCursor).toBeNull()
    const all = [...page1.issues, ...page2.issues].map((i) => i.code)
    expect(new Set(all).size).toBe(total)
  })

  test("a cursor past page 50 runs no query", async () => {
    const cursor = encodeCursor({
      page: 51,
      sort: "laporan",
      key: "1",
      id: crypto.randomUUID(),
    })
    expect(
      await listPublishedIssues(orgA, { urut: "laporan", kursor: cursor }),
    ).toEqual({ kind: "page_cap" })
  })

  test("a malformed cursor is reported", async () => {
    expect(await listPublishedIssues(orgA, { kursor: "abc" })).toEqual({
      kind: "bad_cursor",
    })
  })

  test("a cursor from another sort is reported", async () => {
    for (let i = 0; i <= ISSUE_PAGE_SIZE; i++) await seedIssue()
    const page1 = await listPublishedIssues(orgA, { urut: "laporan" })
    if (page1.kind !== "results") throw new Error(page1.kind)
    const kursor = page1.nextCursor ?? ""
    expect(await listPublishedIssues(orgA, { kursor })).toEqual({
      kind: "bad_cursor",
    })
    const page2 = await listPublishedIssues(orgA, { urut: "laporan", kursor })
    expect(page2.kind).toBe("results")
  })

  test.each([
    ["terbaru", "5", crypto.randomUUID()],
    ["terbaru", "2026-02-30T00:00:00.000000Z", crypto.randomUUID()],
    ["aktivitas", "2026-10-01 07:03:00+07", crypto.randomUUID()],
    ["terbaru", "2026-10-01T00:03:00.000000Z", "-".repeat(36)],
    ["laporan", "abc", crypto.randomUUID()],
    ["laporan", "99999999999", crypto.randomUUID()],
  ] as const)("a forged %s cursor %p is reported", async (sort, key, id) => {
    const kursor = encodeCursor({ page: 2, sort, key, id })
    const query = sort === "terbaru" ? { kursor } : { urut: sort, kursor }
    expect(await listPublishedIssues(orgA, query)).toEqual({
      kind: "bad_cursor",
    })
  })

  test("a search timeout is busy, not an error", async () => {
    const timeout = Object.assign(new Error("canceling statement"), {
      code: "57014",
    })
    const slots = {
      run: () => Promise.reject(timeout),
      tryRun: () => Promise.reject(timeout),
    }
    expect(
      await listPublishedIssues(orgA, { q: "lubang" }, { searchSlots: slots }),
    ).toEqual({ kind: "busy" })
  })

  test("other search errors still throw", async () => {
    const broken = Object.assign(new Error("syntax"), { code: "42601" })
    const slots = {
      run: () => Promise.reject(broken),
      tryRun: () => Promise.reject(broken),
    }
    await expect(
      listPublishedIssues(orgA, { q: "lubang" }, { searchSlots: slots }),
    ).rejects.toBe(broken)
  })
})

describe("cursor", () => {
  test("round-trips", () => {
    const cursor = {
      page: 3,
      sort: "terbaru",
      key: "2026-10-01T00:03:00.000000Z",
      id: crypto.randomUUID(),
    } as const
    const encoded = encodeCursor(cursor)
    expect(encoded).toMatch(/^[A-Za-z0-9_-]{1,200}$/)
    expect(decodeCursor(encoded)).toEqual(cursor)
  })

  test("a cursor without its sort is rejected", () => {
    const old = Buffer.from(
      JSON.stringify([2, "5", crypto.randomUUID()]),
    ).toString("base64url")
    expect(decodeCursor(old)).toBeNull()
  })
})

describe("listShowcases", () => {
  const at = (minute: number) => new Date(Date.UTC(2026, 9, 2, 0, minute))

  test("one status per list, published only, latest activity first", async () => {
    const older = await seedIssue({
      govStatus: "responded",
      lastActivityAt: at(1),
    })
    const newer = await seedIssue({
      govStatus: "responded",
      lastActivityAt: at(5),
    })
    const resolved = await seedIssue({ govStatus: "confirmed_resolved" })
    await seedIssue({ govStatus: "awaiting_response" })
    await seedIssue({ govStatus: "claimed_resolved" })
    await seedIssue({ govStatus: "responded", publishedAt: null })
    const lists = await listShowcases(orgA)
    expect(lists.responded.map((issue) => issue.code)).toEqual([newer, older])
    expect(lists.resolved.map((issue) => issue.code)).toEqual([resolved])
    expect(lists.responded[0]).toEqual({
      code: newer,
      title: "Jalan berlubang di Dago",
      regencyName: "Kota Bandung",
      districtName: null,
      reportCount: 1,
      lastActivityAt: at(5),
    })
  })

  test("caps each list and never crosses tenants", async () => {
    for (let i = 0; i < SHOWCASE_SIZE + 2; i++) {
      await seedIssue({ govStatus: "responded" })
    }
    expect((await listShowcases(orgA)).responded).toHaveLength(SHOWCASE_SIZE)
    expect(await listShowcases(orgB)).toEqual({ responded: [], resolved: [] })
  })
})

describe("listIssueRanking", () => {
  const day = (n: number) => new Date(Date.UTC(2026, 8, n, 3))
  const now = new Date(Date.UTC(2026, 9, 1, 3))

  test("most reports first, published only, capped", async () => {
    const codes: string[] = []
    for (let i = 0; i < RANKING_SIZE + 2; i++) {
      codes.push(await seedIssue({ reportCount: i + 2 }))
    }
    await seedIssue({ reportCount: 99, publishedAt: null })
    const ranked = await listIssueRanking(orgA, "laporan", now)
    expect(ranked.map((issue) => issue.code)).toEqual(
      codes.slice(-RANKING_SIZE).reverse(),
    )
    expect(ranked[0]).toMatchObject({
      title: "Jalan berlubang di Dago",
      categoryId: "program",
      govStatus: "awaiting_response",
      regencyName: "Kota Bandung",
      districtName: null,
      reportCount: RANKING_SIZE + 3,
    })
    expect(await listIssueRanking(orgB, "laporan", now)).toEqual([])
  })

  test("oldest unsettled first, with days since publish", async () => {
    const oldest = await seedIssue({ publishedAt: day(1) })
    const claimed = await seedIssue({
      publishedAt: day(2),
      govStatus: "claimed_resolved",
    })
    await seedIssue({ publishedAt: day(1), govStatus: "confirmed_resolved" })
    await seedIssue({ publishedAt: day(1), govStatus: "closed" })
    const newer = await seedIssue({ publishedAt: day(20) })
    await seedIssue({ publishedAt: null })
    const ranked = await listIssueRanking(orgA, "terlama", now)
    expect(ranked.map((issue) => issue.code)).toEqual([oldest, claimed, newer])
    expect(ranked.map((issue) => issue.days)).toEqual([30, 29, 11])
  })
})

describe("getIssuePage evidence", () => {
  test("lists only published copies of linked reports", async () => {
    const code = await seedIssue()
    const [issue] = await suDb
      .select({ id: issues.id })
      .from(issues)
      .where(eq(issues.publicCode, code))
    const user = await insertUser(su, `bukti.${counter}@contoh.id`)
    const [report] = await suDb
      .insert(reports)
      .values(reportValues(orgA, user, { status: "merged" }))
      .returning({ id: reports.id })
    await su.query(
      "INSERT INTO issue_reports (org_id, issue_id, report_id) VALUES ($1, $2, $3)",
      [orgA, issue?.id, report?.id],
    )
    const media = (file: string) =>
      JSON.stringify([{ type: "image", file, page: 0, width: 4, height: 3 }])
    for (const [position, status, decision, file] of [
      [0, "published", "redact", `${"a".repeat(64)}.webp`],
      [1, "ready", "no_redaction", null],
      [2, "published", "no_redaction", `${"b".repeat(64)}.webp`],
    ] as const) {
      await su.query(
        `INSERT INTO evidence (org_id, report_id, position, kind, declared_name,
           declared_type, declared_size, status, decision, decided_at,
           public_media, published_at)
         VALUES ($1, $2, $3, 'image', 'f', 'image/jpeg', 1, $4, $5, now(), $6, $7)`,
        [
          orgA,
          report?.id,
          position,
          status,
          decision,
          file ? media(file) : null,
          status === "published" ? new Date() : null,
        ],
      )
    }
    const page = await getIssuePage(orgA, code)
    expect(page?.evidence).toEqual([
      {
        kind: "image",
        redacted: true,
        media: [
          {
            type: "image",
            file: `${"a".repeat(64)}.webp`,
            page: 0,
            width: 4,
            height: 3,
          },
        ],
      },
      {
        kind: "image",
        redacted: false,
        media: [
          {
            type: "image",
            file: `${"b".repeat(64)}.webp`,
            page: 0,
            width: 4,
            height: 3,
          },
        ],
      },
    ])
  })
})
