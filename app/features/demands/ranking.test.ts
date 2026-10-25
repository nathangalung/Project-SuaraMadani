import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test"
import { migrate } from "../../../db/migrate.ts"
import {
  insertOrg,
  insertRegions,
  insertUser,
  resetData,
  superuserPool,
  testUrl,
} from "../../../db/testing.ts"
import { RANKING_MIN_RANKERS } from "../../../shared/demands.ts"
import type { SessionContext, TenantContext } from "../../context.ts"
import {
  getDemandPage,
  importantDemands,
  listPublishedDemands,
} from "./demands.server.ts"
import {
  changeDemandState,
  createDemand,
  type DemandFields,
  type DemandTenant,
  getManagedDemand,
} from "./manage.server.ts"
import {
  ownPosition,
  type RankDeps,
  rankDemands,
  rankingPage,
} from "./ranking.server.ts"

const su = superuserPool()
let itb: DemandTenant
let ugm: DemandTenant
let admin = ""

const FIELDS: DemandFields = {
  scope: "national",
  provinceCode: null,
  regencyCode: null,
  category: "pendidikan",
  title: "Transparansi kuota bantuan biaya kuliah",
  body: "Kami menuntut kuota dan kriteria bantuan biaya kuliah dibuka per kampus.",
  summary: "Kuota dan kriteria bantuan biaya kuliah dibuka per kampus.",
  target: "Kementerian Pendidikan Tinggi",
  raisedOn: "2026-09-01",
  briefUrl: null,
}

const pass: RankDeps = { verifyCaptcha: async () => ({ ok: true }) }

function tenantOf(demandTenant: DemandTenant): TenantContext {
  return {
    id: demandTenant.id,
    slug: demandTenant.campusCode.toLowerCase(),
    host: demandTenant.host,
    name: demandTenant.campusCode,
    campusCode: demandTenant.campusCode,
    campusName: demandTenant.campusCode,
    theme: {},
    settings: {},
  }
}

function session(userId: string): SessionContext {
  const at = new Date()
  return {
    user: {
      id: userId,
      email: "warga@contoh.id",
      emailVerified: true,
      phoneVerified: true,
      name: "",
      twoFactorEnabled: false,
      updatedAt: at,
    },
    session: { id: "s", createdAt: at, expiresAt: at },
  }
}

function form(order: string[], fields: Record<string, string> = {}): FormData {
  const data = new FormData()
  const values: Record<string, string> = {
    intent: "rank",
    submissionId: crypto.randomUUID(),
    turnstileToken: "XXXX.DUMMY.TOKEN.XXXX",
    ...fields,
  }
  for (const [key, value] of Object.entries(values)) data.set(key, value)
  for (const [index, code] of order.entries()) {
    data.set(`rank-${code}`, String(index + 1))
  }
  return data
}

let serial = 0

/** Account of a given age. */
async function citizen(days: number, name = ""): Promise<string> {
  serial += 1
  const id = await insertUser(su, `warga${serial}@contoh.id`)
  await su.query(
    "UPDATE users SET name = $2, created_at = now() - $3::int * interval '1 day' WHERE id = $1",
    [id, name, days],
  )
  return id
}

async function make(
  options: { publish?: boolean; tenant?: DemandTenant } = {},
): Promise<string> {
  const tenant = options.tenant ?? itb
  const created = await createDemand(tenant, {
    fields: FIELDS,
    items: ["Kuota per kampus dibuka", "Kriteria penerima dibuka"],
    actorId: admin,
  })
  if (!created.ok) throw new Error(created.reason)
  if (options.publish !== false) await act(tenant, created.code, "publish")
  return created.code
}

async function act(
  tenant: DemandTenant,
  code: string,
  action: "publish" | "close",
) {
  const demand = await getManagedDemand(tenant.id, code)
  const done = await changeDemandState(tenant, {
    code,
    action,
    version: demand?.version ?? 0,
    note: action === "close" ? "Tuntutan ditutup setelah audiensi." : null,
    actorId: admin,
  })
  if (!done.ok) throw new Error(done.reason)
}

function rank(
  userId: string | null,
  order: string[],
  fields: Record<string, string> = {},
  deps: RankDeps = pass,
) {
  return rankDemands({
    tenant: tenantOf(itb),
    session: userId ? session(userId) : null,
    form: form(order, fields),
    remoteIp: null,
    deps,
  })
}

/** n old accounts, same list. */
async function crowd(n: number, order: string[]) {
  for (let i = 0; i < n; i++) {
    const result = await rank(await citizen(30), order)
    expect(result.status).toBe(200)
  }
}

beforeAll(async () => {
  await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
  await resetData(su)
  await insertRegions(su)
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
  admin = await insertUser(su, "admin.peringkat@contoh.id")
})

beforeEach(async () => {
  await su.query("DELETE FROM demand_rankings")
  await su.query("DELETE FROM demands")
})

afterAll(async () => {
  await su.end()
})

describe("rankDemands", () => {
  test("signed out is refused", async () => {
    const code = await make()
    expect(await rank(null, [code])).toEqual({
      status: 401,
      body: { error: "sign_in_required" },
    })
  })

  test("an empty, gapped or doubled order is a field error", async () => {
    const a = await make()
    const b = await make()
    const user = await citizen(30)
    expect(await rank(user, [])).toEqual({
      status: 400,
      body: { errors: ["missing"] },
    })
    // Blank place, or past N
    for (const value of ["", "3"]) {
      expect(await rank(user, [a], { [`rank-${b}`]: value })).toEqual({
        status: 400,
        body: { errors: ["missing"] },
      })
    }
    const twice = form([a])
    twice.set(`rank-${b}`, "1")
    const result = await rankDemands({
      tenant: tenantOf(itb),
      session: session(user),
      form: twice,
      remoteIp: null,
      deps: pass,
    })
    expect(result).toEqual({ status: 400, body: { errors: ["duplicate"] } })
  })

  test("a failed captcha saves nothing", async () => {
    const code = await make()
    const user = await citizen(30)
    const result = await rank(
      user,
      [code],
      {},
      {
        verifyCaptcha: async () => ({ ok: false, reason: "rejected" }),
      },
    )
    expect(result.status).toBe(403)
    expect((await ownPosition(itb.id, code, user)).saved).toBe(false)
  })

  test("a draft cannot be ranked", async () => {
    const draft = await make({ publish: false })
    const result = await rank(await citizen(30), [draft])
    expect(result).toEqual({ status: 404, body: { error: "not_found" } })
  })

  test("every published tuntutan must be placed", async () => {
    const a = await make()
    const b = await make()
    const user = await citizen(30)
    await rank(user, [a, b])
    // Partial list keeps old one
    expect(await rank(user, [b])).toEqual({
      status: 404,
      body: { error: "not_found" },
    })
    expect((await ownPosition(itb.id, b, user)).position).toBe(2)
    // New ones need places
    const c = await make()
    expect((await rank(user, [b, a])).status).toBe(404)
    const page = await rankingPage(itb.id, user)
    expect(
      page.choices.map((choice) => [choice.code, choice.position]),
    ).toEqual([
      [a, 1],
      [b, 2],
      [c, null],
    ])
  })

  test("saving replaces the list; withdraw clears it", async () => {
    const a = await make()
    const b = await make()
    const user = await citizen(30)
    await rank(user, [a, b])
    expect((await ownPosition(itb.id, b, user)).position).toBe(2)
    await rank(user, [b, a])
    expect((await ownPosition(itb.id, a, user)).position).toBe(2)
    expect((await ownPosition(itb.id, b, user)).position).toBe(1)
    const page = await rankingPage(itb.id, user)
    expect(page.saved).toBe(true)
    expect(page.choices.map((choice) => choice.code)).toEqual([b, a])
    await rank(user, [], { intent: "withdraw" })
    expect((await ownPosition(itb.id, b, user)).saved).toBe(false)
  })
})

describe("citizen ranking on public pages", () => {
  test("hidden below the threshold, Borda order above it", async () => {
    const a = await make()
    const b = await make()
    await crowd(RANKING_MIN_RANKERS - 1, [b, a])
    // New accounts never count
    await rank(await citizen(1), [b, a])
    let page = await getDemandPage(itb.id, b)
    expect(page?.ranking.shown).toBe(false)
    expect(page?.rank.place).toBeNull()
    expect(await importantDemands(itb.id, 3)).toEqual([])
    await crowd(1, [a, b])
    page = await getDemandPage(itb.id, b)
    expect(page?.ranking.rankers).toBe(RANKING_MIN_RANKERS)
    // b 19 points, a 11
    expect(page?.rank).toEqual({ place: 1, rankers: RANKING_MIN_RANKERS })
    expect((await importantDemands(itb.id, 3)).map((d) => d.code)).toEqual([
      b,
      a,
    ])
    const sorted = await listPublishedDemands(itb.id, { urut: "peringkat" })
    if (sorted.kind !== "results") throw new Error(sorted.kind)
    expect(sorted.demands.map((d) => d.code)).toEqual([b, a])
  })

  test("each list scores against its own length", async () => {
    const a = await make()
    const b = await make()
    const c = await make()
    await crowd(5, [b, a, c])
    // Old top-five lists, partial
    for (let i = 0; i < 5; i++) {
      await su.query(
        `INSERT INTO demand_rankings (org_id, user_id, demand_id, position)
         SELECT org_id, $1, id, 1 FROM demands WHERE public_code = $2`,
        [await citizen(30), c],
      )
    }
    // Points: b15 c10 a10
    const sorted = await listPublishedDemands(itb.id, { urut: "peringkat" })
    if (sorted.kind !== "results") throw new Error(sorted.kind)
    expect(sorted.demands.map((d) => d.code)).toEqual([b, c, a])
    expect(sorted.demands.map((d) => d.rank.place)).toEqual([1, 2, 3])
  })

  test("a closed tuntutan leaves the ranking", async () => {
    const a = await make()
    await crowd(RANKING_MIN_RANKERS, [a])
    expect((await getDemandPage(itb.id, a))?.rank.place).toBe(1)
    await act(itb, a, "close")
    expect((await getDemandPage(itb.id, a))?.rank.place).toBeNull()
  })

  test("another campus never sees these rankings", async () => {
    const a = await make()
    await crowd(RANKING_MIN_RANKERS, [a])
    const other = await make({ tenant: ugm })
    expect((await getDemandPage(ugm.id, other))?.ranking.rankers).toBe(0)
  })
})
