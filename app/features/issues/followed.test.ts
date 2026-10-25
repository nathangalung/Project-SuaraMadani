import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { migrate } from "../../../db/migrate.ts"
import {
  insertOrg,
  insertRegions,
  insertUser,
  resetData,
  superuserPool,
  testUrl,
} from "../../../db/testing.ts"
import {
  changeDemandState,
  createDemand,
  type DemandFields,
  type DemandTenant,
  getManagedDemand,
} from "../demands/manage.server.ts"
import { listFollowed } from "./followed.server.ts"

const su = superuserPool()
let itb: DemandTenant
let admin = ""
let follower = ""
let other = ""

const FIELDS: DemandFields = {
  scope: "regional",
  provinceCode: "32",
  regencyCode: "32.73",
  category: "infrastruktur_transportasi",
  title: "Layanan air bersih di Kota Bandung",
  body: "Kami menuntut waktu pemulihan suplai air bersih saat gangguan.",
  summary: "Waktu pemulihan suplai air dan tangki air bantuan.",
  target: "Pemerintah Kota Bandung",
  raisedOn: "2026-07-30",
  briefUrl: null,
}

let issueNumber = 0
async function insertIssue(
  title: string,
  fields: { published?: boolean; takenDown?: boolean; activityDays: number },
): Promise<string> {
  issueNumber++
  const { rows } = await su.query<{ id: string }>(
    `INSERT INTO issues (org_id, year, number, public_code, title, summary,
       category_id, subcategory_id, province_code, regency_code, report_count,
       published_at, taken_down_at, takedown_reason, last_activity_at)
     VALUES ($1, 2026, $2, $3, $4, 'Ringkasan.', 'program', 'program.pendidikan',
       '32', '32.73', 1, $5, $6, $7, now() - make_interval(days => $8))
     RETURNING id`,
    [
      itb.id,
      issueNumber,
      `ISU-2026-10-${String(issueNumber).padStart(4, "0")}`,
      title,
      // Takedown also unpublishes
      fields.published === false || fields.takenDown ? null : new Date(),
      fields.takenDown ? new Date() : null,
      fields.takenDown ? "komdigi_order" : null,
      fields.activityDays,
    ],
  )
  const id = rows[0]?.id ?? ""
  await su.query(
    "INSERT INTO follows (org_id, issue_id, user_id) VALUES ($1, $2, $3)",
    [itb.id, id, follower],
  )
  return id
}

async function insertDemand(
  title: string,
  fields: { publish?: boolean; hidden?: boolean; activityDays: number },
): Promise<void> {
  const created = await createDemand(itb, {
    fields: { ...FIELDS, title },
    items: ["Waktu pemulihan"],
    actorId: admin,
  })
  if (!created.ok) throw new Error(created.reason)
  if (fields.publish !== false) {
    const demand = await getManagedDemand(itb.id, created.code)
    const done = await changeDemandState(itb, {
      code: created.code,
      action: "publish",
      version: demand?.version ?? 0,
      note: null,
      actorId: admin,
    })
    if (!done.ok) throw new Error(done.reason)
  }
  await su.query(
    // Hiding returns it to draft
    `UPDATE demands SET hidden_at = $2, hidden_reason = $3,
       state = CASE WHEN $2::timestamptz IS NULL THEN state ELSE 'draft' END,
       last_activity_at = now() - make_interval(days => $4)
     WHERE public_code = $1`,
    [
      created.code,
      fields.hidden ? new Date() : null,
      fields.hidden ? "standard_4" : null,
      fields.activityDays,
    ],
  )
  await su.query(
    `INSERT INTO demand_follows (org_id, demand_id, user_id)
     SELECT org_id, id, $2 FROM demands WHERE public_code = $1`,
    [created.code, follower],
  )
}

beforeAll(async () => {
  await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
  await resetData(su)
  await insertRegions(su)
  itb = {
    id: await insertOrg(su, "itbikut"),
    host: "itbikut.localhost",
    campusCode: "ITB",
  }
  admin = await insertUser(su, "admin.ikut@contoh.id")
  follower = await insertUser(su, "pengikut@contoh.id")
  other = await insertUser(su, "lain@contoh.id")
  await insertIssue("Isu lama", { activityDays: 5 })
  await insertIssue("Isu baru", { activityDays: 1 })
  await insertIssue("Isu draf", { published: false, activityDays: 0 })
  await insertIssue("Isu diturunkan", { takenDown: true, activityDays: 0 })
  await insertDemand("Tuntutan lama", { activityDays: 4 })
  await insertDemand("Tuntutan baru", { activityDays: 2 })
  await insertDemand("Tuntutan draf", { publish: false, activityDays: 0 })
  await insertDemand("Tuntutan disembunyikan", {
    hidden: true,
    activityDays: 0,
  })
})

afterAll(async () => {
  await resetData(su)
  await su.end()
})

describe("listFollowed", () => {
  test("public items only, latest activity first", async () => {
    const followed = await listFollowed(itb.id, follower)
    expect(followed.issues.map((i) => i.title)).toEqual([
      "Isu baru",
      "Isu lama",
    ])
    expect(followed.demands.map((d) => d.title)).toEqual([
      "Tuntutan baru",
      "Tuntutan lama",
    ])
    expect(followed.issues[0]?.state).toEqual({
      advocacy: "monitoring",
      government: "awaiting_response",
    })
  })

  test("another user follows nothing", async () => {
    expect(await listFollowed(itb.id, other)).toEqual({
      issues: [],
      demands: [],
    })
  })
})
