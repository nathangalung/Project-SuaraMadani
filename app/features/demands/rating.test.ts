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
import { hashKey, valueHash } from "../../../server/email-log.ts"
import { CLAIM_RULES } from "../../../shared/claims.ts"
import { IMPORTANCE_MIN_RATERS } from "../../../shared/demands.ts"
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
  hideRaterName,
  namedRatersForAdmin,
  ownRating,
  type RateDeps,
  rateDemand,
  ratingTarget,
} from "./rating.server.ts"

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
}

const pass: RateDeps = {
  verifyCaptcha: async () => ({ ok: true }),
  hashKey: () => Buffer.alloc(32, 7),
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

function form(fields: Record<string, string> = {}): FormData {
  const data = new FormData()
  const values: Record<string, string> = {
    intent: "rate",
    submissionId: crypto.randomUUID(),
    score: "4",
    visibility: "anonymous",
    turnstileToken: "XXXX.DUMMY.TOKEN.XXXX",
    ...fields,
  }
  for (const [key, value] of Object.entries(values)) data.set(key, value)
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

function rate(
  code: string,
  userId: string | null,
  fields: Record<string, string> = {},
  deps: RateDeps = pass,
  tenant: DemandTenant = itb,
  remoteIp: string | null = null,
) {
  return rateDemand({
    tenant: tenantOf(tenant),
    session: userId ? session(userId) : null,
    code,
    form: form(fields),
    remoteIp,
    deps,
  })
}

/** n old accounts, same score. */
async function crowd(code: string, n: number, score: string) {
  for (let i = 0; i < n; i++) {
    const ip = `198.51.100.${i + 1}`
    const result = await rate(code, await citizen(30), { score }, pass, itb, ip)
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
  admin = await insertUser(su, "admin.nilai@contoh.id")
})

beforeEach(async () => {
  await su.query("DELETE FROM demands")
})

afterAll(async () => {
  await su.end()
})

describe("rateDemand", () => {
  test("signed out is refused before anything else", async () => {
    const code = await make()
    expect(await rate(code, null)).toEqual({
      status: 401,
      body: { error: "sign_in_required" },
    })
  })

  test("a failed Turnstile writes nothing", async () => {
    const code = await make()
    const user = await citizen(30)
    const failed = await rate(
      code,
      user,
      {},
      {
        ...pass,
        verifyCaptcha: async () => ({ ok: false, reason: "rejected" }),
      },
    )
    expect(failed).toEqual({ status: 403, body: { error: "captcha_failed" } })
    expect(await ownRating(itb.id, code, user)).toBeNull()
  })

  test("score and visibility are both required", async () => {
    const code = await make()
    const user = await citizen(30)
    expect(await rate(code, user, { score: "6", visibility: "" })).toEqual({
      status: 400,
      body: { errors: ["score", "visibility"] },
    })
  })

  test("one row per account, the last choice wins", async () => {
    const code = await make()
    const user = await citizen(30)
    expect((await rate(code, user, { score: "2" })).status).toBe(200)
    expect(
      (await rate(code, user, { score: "5", visibility: "named" })).status,
    ).toBe(200)
    expect(await ownRating(itb.id, code, user)).toEqual({
      score: 5,
      showName: true,
      counted: true,
    })
    const { rows } = await su.query(
      "SELECT score FROM demand_ratings WHERE user_id = $1",
      [user],
    )
    expect(rows).toEqual([{ score: 5 }])
  })

  test("withdraw removes the row, even after closing", async () => {
    const code = await make()
    const user = await citizen(30)
    await rate(code, user)
    await act(itb, code, "close")
    expect(await rate(code, user, { score: "1" })).toEqual({
      status: 409,
      body: { error: "closed" },
    })
    expect(await rate(code, user, { intent: "withdraw" })).toEqual({
      status: 200,
      body: { saved: "withdrawn" },
    })
    expect(await ownRating(itb.id, code, user)).toBeNull()
  })

  test("drafts and other campuses are not found", async () => {
    const draft = await make({ publish: false })
    const user = await citizen(30)
    expect((await rate(draft, user)).status).toBe(404)
    const elsewhere = await make({ tenant: ugm })
    // Same code, wrong host
    expect((await rate(elsewhere, user, {}, pass, itb)).status).toBe(404)
    expect(await ratingTarget(itb.id, draft)).toBeNull()
  })

  test("a double submit with the same choice is a success", async () => {
    const code = await make()
    const user = await citizen(30)
    await rate(code, user, { score: "3" })
    const duplicate: RateDeps = {
      ...pass,
      verifyCaptcha: async () => ({ ok: false, reason: "duplicate" }),
    }
    expect((await rate(code, user, { score: "3" }, duplicate)).status).toBe(200)
    expect((await rate(code, user, { score: "4" }, duplicate)).status).toBe(403)
  })
})

describe("address prefix", () => {
  // PLAN 5.7: one prefix capped
  test("one address prefix adds at most the cap", async () => {
    const code = await make()
    const ip = "203.0.113.7"
    const first: string[] = []
    for (let i = 0; i < CLAIM_RULES.prefixCap; i++) {
      const user = await citizen(30)
      first.push(user)
      expect((await rate(code, user, {}, pass, itb, ip)).status).toBe(200)
    }
    expect(await rate(code, await citizen(30), {}, pass, itb, ip)).toEqual({
      status: 429,
      body: { error: "prefix_cap" },
    })
    // Own change, other address pass
    const own = first[0] ?? ""
    expect((await rate(code, own, { score: "1" }, pass, itb, ip)).status).toBe(
      200,
    )
    const other = await rate(
      code,
      await citizen(30),
      {},
      pass,
      itb,
      "192.0.2.1",
    )
    expect(other.status).toBe(200)
    const { rows } = await su.query(
      "SELECT count(DISTINCT client_hash)::int AS n FROM demand_ratings WHERE client_hash IS NOT NULL",
    )
    expect(rows).toEqual([{ n: 2 }])
  })

  test("the admin page flags a prefix-heavy tuntutan", async () => {
    const burst = await make()
    for (let i = 0; i < 6; i++) {
      await rate(burst, await citizen(30), {}, pass, itb, "203.0.113.8")
    }
    for (let i = 0; i < 6; i++) {
      await rate(burst, await citizen(30), {}, pass, itb, `192.0.2.${i + 10}`)
    }
    expect((await getManagedDemand(itb.id, burst))?.prefixAnomaly).toBe(true)
    const spread = await make()
    await crowd(spread, 12, "4")
    expect((await getManagedDemand(itb.id, spread))?.prefixAnomaly).toBe(false)
  })
})

describe("public importance", () => {
  test("no mean below the threshold, exact counts", async () => {
    const code = await make()
    await crowd(code, IMPORTANCE_MIN_RATERS - 1, "5")
    const page = await getDemandPage(itb.id, code)
    expect(page?.importance.raters).toBe(IMPORTANCE_MIN_RATERS - 1)
    expect(page?.importance.mean).toBeNull()
  })

  test("mean and distribution at the threshold", async () => {
    const code = await make()
    await crowd(code, 6, "5")
    await crowd(code, 4, "2")
    const page = await getDemandPage(itb.id, code)
    expect(page?.importance).toEqual({
      raters: 10,
      counts: { 1: 0, 2: 4, 3: 0, 4: 0, 5: 6 },
      mean: 3.8,
    })
  })

  test("new accounts are stored but count after seven days", async () => {
    const code = await make()
    const fresh = await citizen(1)
    await rate(code, fresh, { score: "1" })
    expect(await ownRating(itb.id, code, fresh)).toMatchObject({
      counted: false,
    })
    expect((await getDemandPage(itb.id, code))?.importance.raters).toBe(0)
    expect((await getManagedDemand(itb.id, code))?.pendingRaters).toBe(1)
    await su.query(
      "UPDATE users SET created_at = now() - interval '8 days' WHERE id = $1",
      [fresh],
    )
    expect((await getDemandPage(itb.id, code))?.importance.raters).toBe(1)
  })

  test("only opted-in, counted names are listed", async () => {
    const code = await make()
    await rate(code, await citizen(30, "Sari Wulandari"), {
      score: "5",
      visibility: "named",
    })
    await rate(code, await citizen(30, "Anonim Sekali"), { score: "4" })
    await rate(code, await citizen(1, "Akun Baru"), {
      score: "3",
      visibility: "named",
    })
    await rate(code, await citizen(30, "   "), {
      score: "2",
      visibility: "named",
    })
    const named = (await getDemandPage(itb.id, code))?.named
    expect(named?.total).toBe(1)
    expect(named?.shown.map((rater) => [rater.name, rater.score])).toEqual([
      ["Sari Wulandari", 5],
    ])
  })

  test("the citizen order needs enough raters and skips closed", async () => {
    const low = await make()
    const high = await make()
    const few = await make()
    const closed = await make()
    await crowd(low, IMPORTANCE_MIN_RATERS, "2")
    await crowd(high, IMPORTANCE_MIN_RATERS, "5")
    await crowd(few, IMPORTANCE_MIN_RATERS - 1, "5")
    await crowd(closed, IMPORTANCE_MIN_RATERS, "5")
    await act(itb, closed, "close")
    const order = await importantDemands(itb.id, 3)
    expect(order.map((demand) => demand.code)).toEqual([high, low])
    expect(order[0]?.importance.mean).toBe(5)
    // The list keeps the score
    const listed = await listPublishedDemands(itb.id, {})
    if (listed.kind !== "results") throw new Error(listed.kind)
    const row = listed.demands.find((demand) => demand.code === low)
    expect(row?.importance.mean).toBe(2)
    expect(await importantDemands(ugm.id, 3)).toEqual([])
  })

  test("deleting the account removes its rating", async () => {
    const code = await make()
    const user = await citizen(30)
    await rate(code, user)
    await su.query("DELETE FROM users WHERE id = $1", [user])
    const { rows } = await su.query(
      "SELECT 1 FROM demand_ratings WHERE user_id = $1",
      [user],
    )
    expect(rows).toHaveLength(0)
  })
})

// PRIV-23: one abusive name
describe("rater names", () => {
  test("an admin hides one name, audited, sticks", async () => {
    const code = await make()
    const abusive = await citizen(30, "Nama Kasar")
    const kept = await citizen(30, "Sari Wulandari")
    await rate(code, abusive, { score: "5", visibility: "named" })
    await rate(code, kept, { score: "4", visibility: "named" })
    const listed = await namedRatersForAdmin(itb.id, code)
    expect(listed.map((r) => [r.name, r.hidden])).toEqual([
      ["Sari Wulandari", false],
      ["Nama Kasar", false],
    ])
    const purged: string[][] = []
    const deps = {
      purge: {
        purgeUrls: async (urls: string[]) => {
          purged.push(urls)
          return { skipped: false }
        },
        purgeHosts: async () => ({ skipped: false }),
      },
    }
    const input = {
      code,
      userId: abusive,
      reason: "standard_1" as const,
      actorId: admin,
    }
    expect(await hideRaterName(ugm, input, deps)).toEqual({
      ok: false,
      reason: "not_found",
    })
    expect(
      await hideRaterName(
        itb,
        { ...input, reason: "komdigi_order" as unknown as "standard_1" },
        deps,
      ),
    ).toEqual({ ok: false, reason: "not_allowed" })
    expect(await hideRaterName(itb, input, deps)).toEqual({ ok: true })
    expect(purged[0]).toContain(`https://${itb.host}/tuntutan/${code}`)
    const shown = (await getDemandPage(itb.id, code))?.named
    expect(shown?.shown.map((r) => r.name)).toEqual(["Sari Wulandari"])
    expect(shown?.total).toBe(1)
    // Re-rating keeps it hidden
    await rate(code, abusive, { score: "3", visibility: "named" })
    expect(
      (await getDemandPage(itb.id, code))?.named.shown.map((r) => r.name),
    ).toEqual(["Sari Wulandari"])
    const { rows } = await su.query(
      `SELECT actor_id, reason_code, changed_columns, value_hashes FROM audit_log
       WHERE org_id = $1 AND action = 'demand.rater_hide'`,
      [itb.id],
    )
    // Which rater, never in clear
    expect(rows).toEqual([
      {
        actor_id: admin,
        reason_code: "standard_1",
        changed_columns: ["name_hidden_at"],
        value_hashes: { user_id: { old: valueHash(abusive, hashKey()) } },
      },
    ])
    expect(JSON.stringify(rows)).not.toContain(abusive)
    expect(
      (await namedRatersForAdmin(itb.id, code)).find(
        (r) => r.userId === abusive,
      )?.hidden,
    ).toBe(true)
  })
})

describe("category", () => {
  test("filters the public list and is required to publish", async () => {
    const code = await make()
    const other = await createDemand(itb, {
      fields: { ...FIELDS, category: "kesehatan" },
      items: ["Posko kesehatan dibuka"],
      actorId: admin,
    })
    if (!other.ok) throw new Error(other.reason)
    await act(itb, other.code, "publish")
    const listed = await listPublishedDemands(itb.id, {
      kategori: "pendidikan",
    })
    if (listed.kind !== "results") throw new Error(listed.kind)
    expect(listed.demands.map((demand) => demand.code)).toEqual([code])
    expect(listed.demands[0]?.category).toBe("pendidikan")

    // Rows from before 0024
    const legacy = await make({ publish: false })
    await su.query(
      "UPDATE demands SET category = NULL WHERE public_code = $1",
      [legacy],
    )
    const draft = await getManagedDemand(itb.id, legacy)
    expect(
      await changeDemandState(itb, {
        code: legacy,
        action: "publish",
        version: draft?.version ?? 0,
        note: null,
        actorId: admin,
      }),
    ).toEqual({ ok: false, reason: "no_category" })
  })

  test("the database refuses an unknown category", async () => {
    const code = await make({ publish: false })
    await expect(
      su.query(
        "UPDATE demands SET category = 'olahraga' WHERE public_code = $1",
        [code],
      ),
    ).rejects.toThrow()
  })
})
