import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test"
import {
  mkdir,
  mkdtemp,
  rm,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { drizzle } from "drizzle-orm/node-postgres"
import { migrate } from "../db/migrate.ts"
import { reports } from "../db/schema/reports.ts"
import {
  insertOrg,
  insertRegions,
  insertUser,
  reportValues,
  resetData,
  superuserPool,
  testUrl,
} from "../db/testing.ts"
import {
  briefPath,
  derivedPath,
  originalPath,
  partPath,
} from "../server/files.server.ts"
import { createMaintenanceHandler, LOOKUP_CHUNK } from "./maintenance.ts"

const su = superuserPool()
const suDb = drizzle({ client: su })
const DAY = 86_400_000
// mtimes use the real clock
const NOW = new Date()
let orgA = ""
let orgB = ""
let user = ""
let filesDir = ""

async function report(
  org: string,
  values: Partial<typeof reports.$inferInsert>,
) {
  const [row] = await suDb
    .insert(reports)
    .values(reportValues(org, user, values))
    .returning({ id: reports.id })
  return row?.id ?? ""
}

async function file(org: string, reportId: string, status: string) {
  const { rows } = await su.query<{ id: string }>(
    `INSERT INTO evidence (org_id, report_id, position, kind, declared_name,
       declared_type, declared_size, status)
     VALUES ($1, $2, 0, 'image', 'a.jpg', 'image/jpeg', 10, $3) RETURNING id`,
    [org, reportId, status],
  )
  return rows[0]?.id ?? ""
}

async function touch(path: string, age = 0) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, "x")
  const at = new Date(NOW.getTime() - age)
  await utimes(path, at, at)
}

const exists = (path: string) => Bun.file(path).exists()

async function statusOf(id: string) {
  const { rows } = await su.query<{ status: string }>(
    "SELECT status FROM evidence WHERE id = $1",
    [id],
  )
  return rows[0]?.status ?? "gone"
}

function run() {
  return createMaintenanceHandler({ filesDir, now: () => NOW })()
}

beforeAll(async () => {
  await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
  await resetData(su)
  await insertRegions(su)
  orgA = await insertOrg(su, "mta")
  orgB = await insertOrg(su, "mtb")
  user = await insertUser(su, "rawat@contoh.id")
  filesDir = await mkdtemp(join(tmpdir(), "sb-maint-"))
})

beforeEach(async () => {
  await su.query("DELETE FROM reports")
  await su.query("DELETE FROM email_log")
})

afterAll(async () => {
  await rm(filesDir, { recursive: true, force: true })
  await resetData(su)
  await su.query("DELETE FROM email_log")
  await su.end()
})

describe("maintenance-daily", () => {
  test("files that never arrived become missing after 24 h", async () => {
    const old = await report(orgA, {
      createdAt: new Date(NOW.getTime() - 2 * DAY),
    })
    const fresh = await report(orgB, {
      createdAt: new Date(NOW.getTime() - DAY / 2),
    })
    const late = await file(orgA, old, "awaiting_upload")
    const waiting = await file(orgB, fresh, "awaiting_upload")
    const result = await run()
    expect(result.missing).toBe(1)
    expect(await statusOf(late)).toBe("missing")
    expect(await statusOf(waiting)).toBe("awaiting_upload")
  })

  test("rejected originals go after 90 days, newer stay", async () => {
    const old = await report(orgA, {
      status: "rejected",
      updatedAt: new Date(NOW.getTime() - 91 * DAY),
    })
    const recent = await report(orgA, {
      status: "rejected",
      updatedAt: new Date(NOW.getTime() - 10 * DAY),
    })
    const kept = await report(orgB, {
      status: "verified",
      updatedAt: new Date(NOW.getTime() - 200 * DAY),
    })
    const gone = await file(orgA, old, "ready")
    const young = await file(orgA, recent, "ready")
    const verified = await file(orgB, kept, "ready")
    for (const [org, id] of [
      [orgA, gone],
      [orgA, young],
      [orgB, verified],
    ] as const) {
      await touch(originalPath(filesDir, org, id))
      await touch(derivedPath(filesDir, org, id))
    }
    const result = await run()
    expect(result.rejectedFiles).toBe(1)
    expect(await statusOf(gone)).toBe("gone")
    expect(await exists(originalPath(filesDir, orgA, gone))).toBe(false)
    expect(await exists(derivedPath(filesDir, orgA, gone))).toBe(false)
    expect(await exists(originalPath(filesDir, orgA, young))).toBe(true)
    expect(await exists(originalPath(filesDir, orgB, verified))).toBe(true)
  })

  test("email log, sessions and IPs follow /privasi", async () => {
    await su.query(
      `INSERT INTO email_log (kind, address_hash, status, created_at)
       VALUES ('otp', 'a', 'sent', $1), ('otp', 'b', 'sent', $2)`,
      [new Date(NOW.getTime() - 31 * DAY), new Date(NOW.getTime() - DAY)],
    )
    await su.query(
      `INSERT INTO sessions (token, user_id, expires_at, created_at, ip_address, user_agent)
       VALUES ($1, $3, $4, $5, '10.0.0.1', 'UA lama'), ($2, $3, $6, $7, '10.0.0.2', 'UA panjang')`,
      [
        crypto.randomUUID(),
        crypto.randomUUID(),
        user,
        new Date(NOW.getTime() - DAY),
        new Date(NOW.getTime() - 8 * DAY),
        new Date(NOW.getTime() + 5 * DAY),
        new Date(NOW.getTime() - 40 * DAY),
      ],
    )
    const result = await run()
    expect(result.emailLog).toBe(1)
    expect(result.sessions).toBe(1)
    const { rows } = await su.query(
      "SELECT ip_address, user_agent FROM sessions WHERE user_id = $1",
      [user],
    )
    // PRIV-08: user agent like IP
    expect(rows).toEqual([{ ip_address: null, user_agent: null }])
    const log = await su.query("SELECT address_hash FROM email_log")
    expect(log.rows).toEqual([{ address_hash: "b" }])
  })

  test("invitations go 30 days after expiry", async () => {
    // PRIV-19: never-joined addresses
    const at = (days: number) => new Date(NOW.getTime() + days * DAY)
    await su.query(
      `INSERT INTO invitations (organization_id, email, role, status, expires_at, inviter_id) VALUES
       ($1, 'lama.tunggu@contoh.id', 'admin', 'pending', $3, $2),
       ($1, 'lama.terima@contoh.id', 'admin', 'accepted', $3, $2),
       ($1, 'lama.batal@contoh.id', 'admin', 'canceled', $3, $2),
       ($1, 'baru.lewat@contoh.id', 'editor', 'canceled', $4, $2),
       ($1, 'baru.tunggu@contoh.id', 'editor', 'pending', $5, $2)`,
      [orgA, user, at(-31), at(-29), at(5)],
    )
    const result = await run()
    expect(result.invitations).toBe(3)
    const { rows } = await su.query(
      "SELECT email FROM invitations ORDER BY email",
    )
    expect(rows).toEqual([
      { email: "baru.lewat@contoh.id" },
      { email: "baru.tunggu@contoh.id" },
    ])
  })

  test("rating prefixes clear after 30 days", async () => {
    const { rows: issue } = await su.query<{ id: string }>(
      `INSERT INTO issues (org_id, year, number, public_code, title, summary,
         category_id, subcategory_id, province_code, regency_code, gov_status)
       VALUES ($1, 2026, 901, 'ISU-MTA-26-0901', 'Judul isu', 'Ringkasan.',
         'program', 'program.pendidikan', '32', '32.73', 'claimed_resolved')
       RETURNING id`,
      [orgA],
    )
    const { rows: claim } = await su.query<{ id: string }>(
      "INSERT INTO resolution_claims (org_id, issue_id) VALUES ($1, $2) RETURNING id",
      [orgA, issue[0]?.id],
    )
    const fresh = await insertUser(su, "nilai.baru@contoh.id")
    await su.query(
      `INSERT INTO ratings (org_id, claim_id, user_id, score, is_reporter, account_days, client_hash, created_at)
       VALUES ($1, $2, $3, 4, false, 40, 'lama', $5), ($1, $2, $4, 4, false, 40, 'baru', $6)`,
      [
        orgA,
        claim[0]?.id,
        user,
        fresh,
        new Date(NOW.getTime() - 31 * DAY),
        new Date(NOW.getTime() - DAY),
      ],
    )
    const result = await run()
    expect(result.ratingPrefixes).toBe(1)
    const { rows } = await su.query(
      "SELECT client_hash FROM ratings ORDER BY created_at",
    )
    expect(rows).toEqual([{ client_hash: null }, { client_hash: "baru" }])
    await su.query("DELETE FROM issues WHERE id = $1", [issue[0]?.id])
  })

  test("a tuntutan keeps its top prefix, hashes clear", async () => {
    const { rows: demand } = await su.query<{ id: string }>(
      `INSERT INTO demands (org_id, year, number, public_code, scope, title,
         body, summary, target, raised_on)
       VALUES ($1, 2026, 7, 'TUN-MTA-26-0007', 'national', 'Judul',
         'Teks.', 'Ringkasan.', 'Kementerian', '2026-09-01') RETURNING id`,
      [orgA],
    )
    const rated: [string, number][] = [
      ["burst", 31],
      ["burst", 31],
      ["other", 31],
      ["burst", 1],
    ]
    for (const [n, [hash, days]] of rated.entries()) {
      const rater = await insertUser(su, `tuntutan${n}@contoh.id`)
      await su.query(
        `INSERT INTO demand_ratings (org_id, demand_id, user_id, score, client_hash, created_at, updated_at)
         VALUES ($1, $2, $3, 5, $4, $5, $5)`,
        [
          orgA,
          demand[0]?.id,
          rater,
          hash,
          new Date(NOW.getTime() - days * DAY),
        ],
      )
    }
    const result = await run()
    expect(result.ratingPrefixes).toBe(3)
    const { rows } = await su.query(
      `SELECT d.max_prefix_ratings AS n,
         count(r.client_hash)::int AS kept
       FROM demands d JOIN demand_ratings r ON r.demand_id = d.id
       WHERE d.id = $1 GROUP BY d.max_prefix_ratings`,
      [demand[0]?.id],
    )
    expect(rows).toEqual([{ n: 3, kept: 1 }])
    await su.query("DELETE FROM demands WHERE id = $1", [demand[0]?.id])
  })

  test("a claim keeps its top prefix count", async () => {
    const { rows: issue } = await su.query<{ id: string }>(
      `INSERT INTO issues (org_id, year, number, public_code, title, summary,
         category_id, subcategory_id, province_code, regency_code, gov_status)
       VALUES ($1, 2026, 902, 'ISU-MTA-26-0902', 'Judul isu', 'Ringkasan.',
         'program', 'program.pendidikan', '32', '32.73', 'claimed_resolved')
       RETURNING id`,
      [orgA],
    )
    const { rows: claim } = await su.query<{ id: string }>(
      "INSERT INTO resolution_claims (org_id, issue_id) VALUES ($1, $2) RETURNING id",
      [orgA, issue[0]?.id],
    )
    const rated: [string, number][] = [
      ["burst", 31],
      ["burst", 31],
      ["burst", 31],
      ["other", 31],
      ["burst", 1],
    ]
    for (const [n, [hash, days]] of rated.entries()) {
      const rater = await insertUser(su, `prefiks${n}@contoh.id`)
      await su.query(
        `INSERT INTO ratings (org_id, claim_id, user_id, score, is_reporter, account_days, client_hash, created_at)
         VALUES ($1, $2, $3, 5, false, 40, $4, $5)`,
        [orgA, claim[0]?.id, rater, hash, new Date(NOW.getTime() - days * DAY)],
      )
    }
    const stored = async () =>
      (
        await su.query(
          "SELECT max_prefix_ratings AS n FROM resolution_claims WHERE id = $1",
          [claim[0]?.id],
        )
      ).rows
    expect(await stored()).toEqual([{ n: null }])
    expect((await run()).ratingPrefixes).toBe(4)
    expect(await stored()).toEqual([{ n: 4 }])
    // Fresh burst row clears later
    const later = new Date(NOW.getTime() + 31 * DAY)
    await createMaintenanceHandler({ filesDir, now: () => later })()
    expect(await stored()).toEqual([{ n: 4 }])
    await su.query("DELETE FROM issues WHERE id = $1", [issue[0]?.id])
  })

  test("WhatsApp log follows /privasi, 30 days", async () => {
    await su.query("DELETE FROM whatsapp_log")
    await su.query(
      `INSERT INTO whatsapp_log (phone_hash, status, created_at)
       VALUES ('lama', 'sent', $1), ('baru', 'sent', $2)`,
      [new Date(NOW.getTime() - 31 * DAY), new Date(NOW.getTime() - DAY)],
    )
    const result = await run()
    expect(result.whatsappLog).toBe(1)
    const { rows } = await su.query("SELECT phone_hash FROM whatsapp_log")
    expect(rows).toEqual([{ phone_hash: "baru" }])
    await su.query("DELETE FROM whatsapp_log")
  })

  test("expired sign-in codes go", async () => {
    await su.query("DELETE FROM verifications")
    await su.query(
      `INSERT INTO verifications (identifier, value, expires_at)
       VALUES ('lama', 'x', $1), ('baru', 'y', $2)`,
      [new Date(NOW.getTime() - 1000), new Date(NOW.getTime() + 300_000)],
    )
    const result = await run()
    expect(result.verifications).toBe(1)
    const { rows } = await su.query("SELECT identifier FROM verifications")
    expect(rows).toEqual([{ identifier: "baru" }])
    await su.query("DELETE FROM verifications")
  })

  test("WhatsApp contact sessions idle 30 days go, creds stay", async () => {
    await su.query("DELETE FROM whatsapp_auth")
    const old = new Date(NOW.getTime() - 31 * DAY)
    await su.query(
      `INSERT INTO whatsapp_auth (key, value, updated_at)
       VALUES ('creds', '\\x00', $1), ('pre-key-1', '\\x00', $1),
              ('session-lama', '\\x00', $1), ('session-baru', '\\x00', $2)`,
      [old, new Date(NOW.getTime() - DAY)],
    )
    const result = await run()
    expect(result.whatsappSessions).toBe(1)
    const { rows } = await su.query(
      "SELECT key FROM whatsapp_auth ORDER BY key",
    )
    expect(rows.map((row) => row.key)).toEqual([
      "creds",
      "pre-key-1",
      "session-baru",
    ])
    await su.query("DELETE FROM whatsapp_auth")
  })

  test("orphan and stale temp files go, fresh ones stay", async () => {
    const own = await report(orgA, {})
    const live = await file(orgA, own, "received")
    const liveFile = originalPath(filesDir, orgA, live)
    await touch(liveFile, 2 * DAY)
    const orphan = originalPath(filesDir, orgA, crypto.randomUUID())
    await touch(orphan, 2 * DAY)
    const orphanDerived = derivedPath(filesDir, orgA, crypto.randomUUID())
    await touch(orphanDerived, 2 * DAY)
    const old = new Date(NOW.getTime() - 2 * DAY)
    await utimes(dirname(orphanDerived), old, old)
    const newOrphan = originalPath(filesDir, orgA, crypto.randomUUID())
    await touch(newOrphan, 60_000)
    const temp = join(dirname(liveFile), `.tmp-${crypto.randomUUID()}`)
    await touch(temp, 2 * DAY)
    const stalePart = partPath(filesDir, orgA, crypto.randomUUID())
    await touch(stalePart, 2 * DAY)
    const freshPart = partPath(filesDir, orgA, crypto.randomUUID())
    await touch(freshPart, 60_000)
    const result = await run()
    expect(result.orphans).toBe(4)
    expect(await exists(liveFile)).toBe(true)
    expect(await exists(orphan)).toBe(false)
    expect(await exists(orphanDerived)).toBe(false)
    expect(await exists(temp)).toBe(false)
    expect(await exists(stalePart)).toBe(false)
    expect(await exists(freshPart)).toBe(true)
    expect(await exists(newOrphan)).toBe(true)
  })

  test("Given a temp file vanishing mid-sweep, when maintenance runs, then the sweep goes on", async () => {
    // Earlier leftovers cleared first
    await run()
    const dir = dirname(originalPath(filesDir, orgA, crypto.randomUUID()))
    const stale = join(dir, `.tmp-${crypto.randomUUID()}`)
    await touch(stale, 2 * DAY)
    // Listed, then stat fails
    await symlink(join(dir, "gone"), join(dir, `.tmp-${crypto.randomUUID()}`))
    const result = await run()
    expect(result.orphans).toBe(1)
    expect(await exists(stale)).toBe(false)
  })

  test("a send stuck in sending for an hour is queued again", async () => {
    const own = await report(orgA, {})
    const { rows } = await su.query<{ id: string }>(
      `INSERT INTO notifications (org_id, user_id, event_id, template, report_id, status, claimed_at)
       VALUES ($1, $2, uuidv7(), 'report_verified', $3, 'sending', $4),
              ($1, $2, uuidv7(), 'report_verified', $3, 'sending', $5)
       RETURNING id`,
      [
        orgA,
        user,
        own,
        new Date(NOW.getTime() - 2 * 3_600_000),
        new Date(NOW.getTime() - 60_000),
      ],
    )
    const result = await run()
    expect(result.requeued).toBe(1)
    const { rows: after } = await su.query<{ id: string; status: string }>(
      "SELECT id, status FROM notifications WHERE id = ANY($1) ORDER BY claimed_at NULLS FIRST",
      [rows.map((row) => row.id)],
    )
    expect(after.map((row) => row.status)).toEqual(["pending", "sending"])
    const jobs = await su.query(
      "SELECT 1 FROM pgboss.job WHERE name = 'email-send' AND data->>'notificationId' = $1",
      [after[0]?.id],
    )
    expect(jobs.rows).toHaveLength(1)
  })

  test("an expired email_log row clears its notification link", async () => {
    const own = await report(orgA, {})
    const { rows: log } = await su.query<{ id: string }>(
      `INSERT INTO email_log (kind, address_hash, status, created_at)
       VALUES ('notification', 'tautan', 'sent', $1) RETURNING id`,
      [new Date(NOW.getTime() - 31 * DAY)],
    )
    const { rows } = await su.query<{ id: string }>(
      `INSERT INTO notifications (org_id, user_id, event_id, template, report_id, status, email_log_id)
       VALUES ($1, $2, uuidv7(), 'report_verified', $3, 'sent', $4) RETURNING id`,
      [orgA, user, own, log[0]?.id],
    )
    expect((await run()).emailLog).toBe(1)
    const { rows: after } = await su.query(
      "SELECT email_log_id FROM notifications WHERE id = $1",
      [rows[0]?.id],
    )
    expect(after).toEqual([{ email_log_id: null }])
  })

  test("infected policy briefs go with their files", async () => {
    const { rows } = await su.query<{ id: string }>(
      `INSERT INTO demands (org_id, year, number, public_code, scope, title,
         body, summary, target, raised_on)
       VALUES ($1, 2026, 1, 'TUN-MTA-26-0001', 'national', 'Judul',
         'Teks.', 'Ringkasan.', 'Kementerian', '2026-09-01') RETURNING id`,
      [orgA],
    )
    const item = await su.query<{ id: string }>(
      `INSERT INTO demand_items (org_id, demand_id, position, body)
       VALUES ($1, $2, 0, 'Sub-tuntutan') RETURNING id`,
      [orgA, rows[0]?.id],
    )
    const brief = (status: string) =>
      su.query<{ id: string }>(
        `INSERT INTO policy_briefs (org_id, item_id, status, sha256, byte_size, scanned_at)
         VALUES ($1, $2, $3, repeat('a', 64), 10, CASE WHEN $3 = 'pending' THEN NULL ELSE now() END)
         RETURNING id`,
        [orgA, item.rows[0]?.id, status],
      )
    const infected = (await brief("infected")).rows[0]?.id ?? ""
    const clean = (await brief("clean")).rows[0]?.id ?? ""
    await touch(briefPath(filesDir, orgA, infected))
    await touch(briefPath(filesDir, orgA, clean), 2 * DAY)
    // Row gone some other way
    const orphan = briefPath(filesDir, orgA, crypto.randomUUID())
    await touch(orphan, 2 * DAY)
    const fresh = briefPath(filesDir, orgA, crypto.randomUUID())
    await touch(fresh, 60_000)
    const result = await run()
    expect(result.infectedBriefs).toBe(1)
    expect(await exists(orphan)).toBe(false)
    expect(await exists(fresh)).toBe(true)
    expect(await exists(briefPath(filesDir, orgA, infected))).toBe(false)
    expect(await exists(briefPath(filesDir, orgA, clean))).toBe(true)
    const left = await su.query("SELECT status FROM policy_briefs")
    expect(left.rows).toEqual([{ status: "clean" }])
    await su.query("DELETE FROM demands")
    await rm(briefPath(filesDir, orgA, clean), { force: true })
  })

  test("orphan lookups stay under the bind limit", async () => {
    const dir = join(filesDir, "evidence", orgB)
    await mkdir(dir, { recursive: true })
    // More files than one chunk
    for (let i = 0; i < LOOKUP_CHUNK + 5; i++) {
      await touch(join(dir, crypto.randomUUID()), 2 * DAY)
    }
    const result = await run()
    expect(result.orphans).toBe(LOOKUP_CHUNK + 5)
  })
})
