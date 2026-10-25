import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { drizzle } from "drizzle-orm/node-postgres"
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
import {
  dropJobs,
  type FullApp,
  fullApp,
  hostsChanged,
  insertedUsers,
  loaderWith,
} from "../../../e2e/app-harness.ts"
import {
  changeDemandState,
  createDemand,
  type DemandFields,
  type DemandTenant,
  getManagedDemand,
} from "../demands/manage.server.ts"

const HOST = "acchome.localhost"
const su = superuserPool()
let app: FullApp
let tenant: DemandTenant
let admin = ""

const FIELDS: DemandFields = {
  scope: "regional",
  provinceCode: "32",
  regencyCode: null,
  category: "infrastruktur_transportasi",
  title: "Tuntutan beranda",
  body: "Kami menuntut perbaikan layanan publik di Jawa Barat.",
  summary: "Perbaikan layanan publik dan jadwal yang terbuka.",
  target: "Pemerintah Provinsi Jawa Barat",
  raisedOn: "2026-07-30",
}

/** Published tuntutan, Given step. */
async function published(title: string): Promise<string> {
  const created = await createDemand(tenant, {
    fields: { ...FIELDS, title },
    items: ["Satu"],
    actorId: admin,
  })
  if (!created.ok) throw new Error(created.reason)
  const managed = await getManagedDemand(tenant.id, created.code)
  const done = await changeDemandState(tenant, {
    code: created.code,
    action: "publish",
    version: managed?.version ?? 0,
    note: null,
    actorId: admin,
  })
  if (!done.ok) throw new Error("publish refused")
  return created.code
}

/** One list per account. */
async function ranked(lists: string[][], ageDays: number) {
  const accounts = await insertedUsers(su, lists.length, ageDays)
  for (const [n, list] of lists.entries()) {
    for (const [index, code] of list.entries()) {
      await su.query(
        `INSERT INTO demand_rankings (org_id, demand_id, user_id, position)
         SELECT org_id, id, $2, $3 FROM demands WHERE public_code = $1`,
        [code, accounts[n], index + 1],
      )
    }
  }
}

beforeAll(async () => {
  await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
  await resetData(su)
  await insertRegions(su)
  const orgId = await insertOrg(su, "acchome")
  hostsChanged([HOST])
  tenant = { id: orgId, host: HOST, campusCode: "ACCHOME" }
  admin = await insertUser(su, "admin.acchome@contoh.id")
  app = await fullApp()
})

afterAll(async () => {
  await dropJobs(su, [HOST])
  // Later files rebuild auth
  hostsChanged([HOST])
  await resetData(su)
  await su.end()
})

type Home = {
  issues: { code: string }[]
  demands: { latest: { code: string }[]; important: { code: string }[] }
}

describe("campus home", () => {
  test("[AC-HOME-01] Given ranked tuntutan and published issues, when the campus home is read, then the citizens' top three go by Borda points then rankers and count only accounts at least seven days old, the latest three come newest first, and six issues are listed newest first", async () => {
    const top = await published("Peringkat pertama")
    const many = await published("Dua puluh empat poin, enam warga")
    const few = await published("Dua puluh empat poin, lima warga")
    const young = await published("Hanya akun baru")
    // Points 35, 24, 24, 0
    await ranked(
      [
        ...Array.from({ length: 6 }, () => [top, many]),
        ...Array.from({ length: 4 }, () => [few]),
        [top, few],
      ],
      30,
    )
    await ranked([[young, few, many]], 1)
    const base = {
      orgId: tenant.id,
      year: 2026,
      summary: "Warga melaporkan masalah di jalan utama.",
      categoryId: "program",
      subcategoryId: "program.infrastruktur",
      provinceCode: "32",
      regencyCode: "32.73",
      reportCount: 1,
    }
    const at = (hours: number) => new Date(Date.now() - hours * 3_600_000)
    const code = (n: number) => `ISU-2026-10-${String(n).padStart(4, "0")}`
    await drizzle({ client: su })
      .insert(issues)
      .values([
        ...[1, 2, 3, 4, 5, 6, 7].map((n) => ({
          ...base,
          number: n,
          publicCode: code(n),
          title: `Isu terbit ${n}`,
          publishedAt: at(10 - n),
        })),
        // Newest, never reviewed
        { ...base, number: 8, publicCode: code(8), title: "Belum terbit" },
      ])
    const res = await app.request(`http://${HOST}/.data`)
    expect(res.status).toBe(200)
    const home = await loaderWith<Home>(res, "demands")
    const codes = (list: { code: string }[]) => list.map((one) => one.code)
    expect(codes(home.demands.important)).toEqual([top, many, few])
    expect(codes(home.demands.latest)).toEqual([young, few, many])
    expect(codes(home.issues)).toEqual([7, 6, 5, 4, 3, 2].map(code))
  })
})
