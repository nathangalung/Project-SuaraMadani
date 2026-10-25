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
import { CAPTCHA_PASS, stubTurnstile } from "../../../e2e/app-harness.ts"
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
  rankRequest,
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

const KEY = Buffer.alloc(32, 7)
const pass: RankDeps = {
  verifyCaptcha: async () => ({ ok: true }),
  hashKey: () => KEY,
}

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
  remoteIp: string | null = `10.20.${serial}.1`,
) {
  return rankDemands({
    tenant: tenantOf(itb),
    session: userId ? session(userId) : null,
    form: form(order, fields),
    remoteIp,
    deps,
  })
}

/** Full list, these codes first. */
async function all(...first: string[]): Promise<string[]> {
  const { rows } = await su.query<{ code: string }>(
    `SELECT public_code AS code FROM demands
     WHERE org_id = $1 AND state = 'published' ORDER BY public_code`,
    [itb.id],
  )
  const rest = rows.map((row) => row.code).filter((c) => !first.includes(c))
  return [...first, ...rest]
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
        ...pass,
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

describe("ranking safeguards", () => {
  test("one tuntutan entered twice is a field error", async () => {
    const a = await make()
    const user = await citizen(30)
    const twice = form([])
    twice.append(`rank-${a}`, "1")
    twice.append(`rank-${a}`, "2")
    const result = await rankDemands({
      tenant: tenantOf(itb),
      session: session(user),
      form: twice,
      remoteIp: null,
      deps: pass,
    })
    expect(result).toEqual({ status: 400, body: { errors: ["duplicate"] } })
    expect((await ownPosition(itb.id, a, user)).saved).toBe(false)
  })

  test("twenty accounts per address prefix, whatever their order", async () => {
    const a = await make()
    const b = await make()
    const users: string[] = []
    for (let i = 0; i < 20; i++) {
      const user = await citizen(30)
      users.push(user)
      const order = i % 2 === 0 ? [a, b] : [b, a]
      const saved = await rank(user, order, {}, pass, "10.66.0.9")
      expect(saved.status).toBe(200)
    }
    const extra = await citizen(30)
    expect((await rank(extra, [b, a], {}, pass, "10.70.0.1")).status).toBe(200)
    for (const order of [
      [a, b],
      [b, a],
    ]) {
      expect(await rank(extra, order, {}, pass, "10.66.0.9")).toEqual({
        status: 429,
        body: { error: "prefix_cap" },
      })
    }
    // Old list stays whole
    expect((await ownPosition(itb.id, b, extra)).position).toBe(1)
    expect((await ownPosition(itb.id, a, extra)).position).toBe(2)
    // A later tuntutan reopens nothing
    const c = await make()
    expect((await rank(extra, [c, a, b], {}, pass, "10.66.0.9")).status).toBe(
      429,
    )
    expect((await rank(extra, [c, a, b], {}, pass, "10.67.0.9")).status).toBe(
      200,
    )
    // Own resave is not counted
    const first = users[0] as string
    expect((await rank(first, [c, b, a], {}, pass, "10.66.0.9")).status).toBe(
      200,
    )
  })

  test("two accounts racing for the last prefix place", async () => {
    const a = await make()
    for (let i = 0; i < 19; i++) {
      expect(
        (await rank(await citizen(30), [a], {}, pass, "10.55.0.1")).status,
      ).toBe(200)
    }
    const racers: string[] = []
    for (let i = 0; i < 6; i++) racers.push(await citizen(30))
    const results = await Promise.all(
      racers.map((user) => rank(user, [a], {}, pass, "10.55.0.1")),
    )
    expect(results.map((r) => r.status).toSorted()).toEqual([
      200, 429, 429, 429, 429, 429,
    ])
    const { rows } = await su.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM demand_rankings WHERE client_hash IS NOT NULL",
    )
    expect(rows[0]?.n).toBe(20)
  })

  test("an unknown intent or submission id is refused", async () => {
    const a = await make()
    const user = await citizen(30)
    const bad: Record<string, string>[] = [
      { intent: "vote" },
      { submissionId: "satu" },
    ]
    for (const fields of bad) {
      expect(await rank(user, [a], fields)).toEqual({
        status: 400,
        body: { errors: [] },
      })
    }
    expect((await ownPosition(itb.id, a, user)).saved).toBe(false)
  })

  test("a body past the form cap is refused unread", async () => {
    const request = new Request("http://itb.localhost/tuntutan/peringkat", {
      method: "POST",
      headers: { "content-length": String(64 * 1024 + 1) },
      body: "x",
    })
    expect(
      await rankRequest({
        request,
        tenant: tenantOf(itb),
        session: session(await citizen(30)),
      }),
    ).toEqual({ status: 413 })
  })

  test("a full list of 350 tuntutan saves", async () => {
    await su.query(
      `INSERT INTO demands (org_id, year, number, public_code, scope, category,
         title, body, summary, target, raised_on, state, published_at)
       SELECT $1, 2026, n, 'TUN-ITB-26-' || lpad(n::text, 6, '0'), 'national',
         'pendidikan', 'Tuntutan ' || n, 'Isi tuntutan nomor ' || n,
         'Ringkasan ' || n, 'Kementerian', '2026-09-01', 'published', now()
       FROM generate_series(100001, 100350) AS n`,
      [itb.id],
    )
    const order = await all()
    expect(order).toHaveLength(350)
    const body = new URLSearchParams({
      intent: "rank",
      submissionId: crypto.randomUUID(),
      turnstileToken: CAPTCHA_PASS,
    })
    for (const [index, code] of order.toReversed().entries()) {
      body.append(`rank-${code}`, String(index + 1))
    }
    const bytes = new TextEncoder().encode(body.toString())
    // Over the old cap
    expect(bytes.byteLength).toBeGreaterThan(8 * 1024)
    const user = await citizen(30)
    const restore = stubTurnstile()
    try {
      const result = await rankRequest({
        request: new Request("http://itb.localhost/tuntutan/peringkat", {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            "content-length": String(bytes.byteLength),
          },
          body: bytes,
        }),
        tenant: tenantOf(itb),
        session: session(user),
      })
      expect(result).toEqual({ status: 200, body: { saved: "ranked" } })
    } finally {
      restore()
    }
    const last = order[0] as string
    expect((await ownPosition(itb.id, last, user)).position).toBe(350)
  })

  test("a refused list keeps the saved one", async () => {
    const a = await make()
    const b = await make()
    const user = await citizen(30)
    await rank(user, [a, b])
    await act(itb, b, "close")
    // Closed since the page loaded
    expect(await rank(user, [b, a])).toEqual({
      status: 404,
      body: { error: "not_found" },
    })
    expect((await ownPosition(itb.id, a, user)).position).toBe(1)
    // Published since the page loaded
    const c = await make()
    expect(await rank(user, [a])).toEqual({
      status: 404,
      body: { error: "not_found" },
    })
    expect((await rank(user, [c, a])).status).toBe(200)
    expect((await ownPosition(itb.id, c, user)).position).toBe(1)
  })

  test("another campus's tuntutan cannot be ranked here", async () => {
    const a = await make()
    const other = await make({ tenant: ugm })
    const user = await citizen(30)
    expect((await rank(user, [a])).status).toBe(200)
    for (const order of [[a, other], [other]]) {
      expect(await rank(user, order)).toEqual({
        status: 404,
        body: { error: "not_found" },
      })
    }
    expect((await ownPosition(itb.id, a, user)).position).toBe(1)
    const { rows } = await su.query(
      "SELECT 1 FROM demand_rankings WHERE org_id = $1",
      [ugm.id],
    )
    expect(rows).toEqual([])
  })

  test("hostile codes and places are refused, the list kept", async () => {
    const a = await make()
    const user = await citizen(30)
    expect((await rank(user, [a])).status).toBe(200)
    const hostile = [
      { [`rank-${a}`]: "1", "rank-'; DROP TABLE demands;--": "2" },
      { [`rank-${a}`]: "1", "rank-": "2" },
      { [`rank-${a}`]: "1", "rank-TUN-ITB-26-0001\u0000": "2" },
    ]
    for (const fields of hostile) {
      expect((await rank(user, [], fields)).status).toBe(404)
    }
    // Not ASCII digits
    for (const place of ["\u0661", "0", "-1", "1.5", "99999"]) {
      expect(await rank(user, [], { [`rank-${a}`]: place })).toEqual({
        status: 400,
        body: { errors: ["missing"] },
      })
    }
    expect((await ownPosition(itb.id, a, user)).position).toBe(1)
  })

  test("with nothing published a list is refused, withdraw still clears", async () => {
    const a = await make()
    const user = await citizen(30)
    expect((await rank(user, [a])).status).toBe(200)
    await act(itb, a, "close")
    expect(await rank(user, [])).toEqual({
      status: 400,
      body: { errors: ["missing"] },
    })
    const page = await rankingPage(itb.id, user)
    expect(page).toMatchObject({ choices: [], saved: true })
    expect((await rank(user, [], { intent: "withdraw" })).status).toBe(200)
    expect((await rankingPage(itb.id, user)).saved).toBe(false)
  })

  test("a double submit of the same list succeeds", async () => {
    const a = await make()
    const user = await citizen(30)
    expect((await rank(user, [a])).status).toBe(200)
    const replay: RankDeps = {
      ...pass,
      verifyCaptcha: async () => ({ ok: false, reason: "duplicate" }),
    }
    expect(await rank(user, [a], {}, replay)).toEqual({
      status: 200,
      body: { saved: "ranked" },
    })
    const b = await make()
    expect((await rank(user, await all(b), {}, replay)).status).toBe(403)
  })

  test("concurrent saves keep one whole list", async () => {
    const a = await make()
    const b = await make()
    const c = await make()
    const user = await citizen(30)
    const results = await Promise.all([
      rank(user, [a, b, c], {}, pass, "10.30.0.1"),
      rank(user, [c, a, b], {}, pass, "10.31.0.1"),
      rank(user, [b, c, a], {}, pass, "10.30.0.1"),
    ])
    expect(results.map((r) => r.status)).toEqual([200, 200, 200])
    const { rows } = await su.query<{ code: string }>(
      `SELECT d.public_code AS code FROM demand_rankings r
       JOIN demands d ON d.id = r.demand_id
       WHERE r.user_id = $1 ORDER BY r.position`,
      [user],
    )
    const saved = rows.map((row) => row.code)
    expect([
      [a, b, c],
      [c, a, b],
      [b, c, a],
    ]).toContainEqual(saved)
  })

  test("the admin flag needs over 30% from one prefix", async () => {
    const flagOf = async (shared: number) => {
      const a = await make()
      for (let i = 0; i < 10; i++) {
        const ip = i < shared ? "10.80.0.1" : `10.81.${shared}.${i}`
        const saved = await rank(await citizen(30), await all(a), {}, pass, ip)
        expect(saved.status).toBe(200)
      }
      return (await getManagedDemand(itb.id, a))?.prefixAnomaly
    }
    expect(await flagOf(4)).toBe(true)
    expect(await flagOf(3)).toBe(false)
  })

  test("the flag outlives the cleared hashes", async () => {
    const a = await make()
    for (let i = 0; i < 10; i++) {
      await rank(await citizen(30), [a], {}, pass, `10.90.0.${i}`)
    }
    expect((await getManagedDemand(itb.id, a))?.prefixAnomaly).toBe(false)
    await su.query(
      "UPDATE demands SET max_prefix_rankings = 4 WHERE public_code = $1",
      [a],
    )
    expect((await getManagedDemand(itb.id, a))?.prefixAnomaly).toBe(true)
  })
})
