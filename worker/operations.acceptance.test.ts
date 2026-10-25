import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { readdir, rm } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { drizzle } from "drizzle-orm/node-postgres"
import { Pool } from "pg"
import sharp from "sharp"
import { createDatabase, schema } from "../db/client.server.ts"
import { migrate } from "../db/migrate.ts"
import {
  insertOrg,
  insertRegions,
  resetData,
  superuserPool,
  testUrl,
} from "../db/testing.ts"
import {
  dropJobs,
  type FullApp,
  fullApp,
  hostsChanged,
  queued,
  runQueued,
  type Staff,
  signedIn,
  staffSession,
  stubTurnstile,
} from "../e2e/app-harness.ts"
import {
  issueRow,
  postForm,
  publishIssue,
  reportToIssue,
  review,
  submitReport,
} from "../e2e/staff-flows.ts"
import { defaultFilesDir, originalPath } from "../server/files.server.ts"
import { setErrorReporter } from "../server/log.ts"
import { createPurgeClient } from "../server/purge.server.ts"
import { createEvidenceHandler } from "./evidence.ts"
import { createPublishHandler } from "./evidence-publish.ts"
import { startWorker } from "./index.ts"
import { createMaintenanceHandler } from "./maintenance.ts"
import { localStore } from "./media-store.ts"
import { createTakedownHandler } from "./takedown.ts"

const HOST = "accops.localhost"
const ORIGIN = `http://${HOST}`
const su = superuserPool()
// worker-media role, real grants
const mediaPool = new Pool({
  connectionString: testUrl("TEST_DATABASE_SUPERUSER_URL"),
  max: 2,
  options: "-c role=sb_media",
})
const mediaDb = drizzle({ client: mediaPool, schema })
let app: FullApp
let orgId = ""
let admin: Staff
let restore = () => {}
let seq = 0

function person(label: string) {
  seq += 1
  return {
    email: `${label}.${seq}@contoh.id`,
    phone: `+62813666${String(seq).padStart(5, "0")}`,
    name: "Warga Operasi",
  }
}

/** Photo with GPS in EXIF. */
async function gpsJpeg(): Promise<Uint8Array<ArrayBuffer>> {
  const buffer = await sharp({
    create: { width: 64, height: 48, channels: 3, background: "#4a7f2c" },
  })
    .withExifMerge({
      IFD0: { Make: "KameraRahasia", Artist: "Nama Pelapor" },
    })
    .jpeg()
    .toBuffer()
  return new Uint8Array(buffer)
}

/** Public media of this campus. */
async function publicFiles(): Promise<string[]> {
  const dir = join(resolve(defaultFilesDir()), "public", HOST)
  const names = await readdir(dir, { recursive: true }).catch(() => [])
  return names.map(String).sort()
}

/** Report, photo uploaded, issue published. */
async function publishedWithPhoto(
  decision: Record<string, string> = { decision: "no_redaction" },
) {
  const owner = await signedIn(HOST, person("foto"))
  const jpeg = await gpsJpeg()
  const sent = await submitReport(app, HOST, owner.cookie, {
    evidence: [{ name: "foto.jpg", size: jpeg.length, type: "image/jpeg" }],
  })
  const evidenceId = sent.evidence[0]?.id ?? ""
  const upload = await app.request(`${ORIGIN}/api/upload/${evidenceId}`, {
    method: "POST",
    headers: { cookie: owner.cookie, origin: ORIGIN },
    body: jpeg,
  })
  if (upload.status !== 201) throw new Error(`upload ${upload.status}`)
  const scan = createEvidenceHandler({
    filesDir: defaultFilesDir(),
    db: mediaDb,
  })
  await runQueued(
    su,
    "evidence",
    orgId,
    (data: { orgId: string; evidenceId: string }) => scan(data),
  )
  const decided = await postForm(
    app,
    `${ORIGIN}/kelola/bukti/${evidenceId}/sunting`,
    admin.cookie,
    { intent: "decide", seen: "", ...decision },
  )
  if (decided.status !== 303) throw new Error(`decide ${decided.status}`)
  const issue = await reportToIssue(app, su, HOST, admin.cookie, sent.code)
  await publishIssue(app, su, HOST, admin.cookie, issue)
  const publish = createPublishHandler({
    filesDir: defaultFilesDir(),
    db: mediaDb,
    store: localStore(() => defaultFilesDir()),
  })
  const outcomes = await runQueued(
    su,
    "evidence-publish",
    orgId,
    (data: { orgId: string; evidenceId: string }) => publish(data),
  )
  return { issue, evidenceId, owner, jpeg, outcomes }
}

beforeAll(async () => {
  await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
  await resetData(su)
  await insertRegions(su)
  orgId = await insertOrg(su, "accops")
  hostsChanged([HOST])
  restore = stubTurnstile()
  app = await fullApp()
  admin = await staffSession(HOST, orgId, person("admin"))
})

afterAll(async () => {
  await dropJobs(su, [HOST])
  // Later files rebuild auth
  hostsChanged([HOST])
  restore()
  const root = resolve(defaultFilesDir())
  await rm(dirname(originalPath(defaultFilesDir(), orgId, "x")), {
    recursive: true,
    force: true,
  })
  await rm(join(root, "derived", orgId), { recursive: true, force: true })
  await rm(join(root, "public", HOST), { recursive: true, force: true })
  await resetData(su)
  await mediaPool.end()
  await su.end()
})

describe("evidence and takedown pipeline", () => {
  test("[AC-OPS-01] Given a reporter's photo with camera and author EXIF, when it is scanned, approved without redaction and its issue published, then a re-encoded WebP without metadata is public and the original stays private", async () => {
    const { issue, evidenceId } = await publishedWithPhoto()
    const json = await (
      await app.request(`${ORIGIN}/api/v1/isu/${issue}`)
    ).json()
    const src = json.issue.evidence[0]?.media?.[0]?.src as string | undefined
    if (!src) throw new Error("no public media")
    const media = await app.request(src)
    expect(media.status).toBe(200)
    expect(media.headers.get("Content-Type")).toBe("image/webp")
    expect(media.headers.get("X-Content-Type-Options")).toBe("nosniff")
    expect(media.headers.get("Content-Security-Policy")).toContain("sandbox")
    const bytes = Buffer.from(await media.arrayBuffer())
    const meta = await sharp(bytes).metadata()
    expect(meta.format).toBe("webp")
    expect(meta.exif).toBeUndefined()
    expect(bytes.includes(Buffer.from("KameraRahasia"))).toBe(false)
    const original = await app.request(
      `${ORIGIN}/kelola/bukti/${evidenceId}/asli`,
    )
    expect(original.status).toBe(403)
  })

  test("[AC-OPS-06] Given a reporter's photo, when an admin covers part of it with a redaction box and its issue is published, then the public WebP has the box burned in and the original stays unchanged", async () => {
    // Left half, black fill
    const box = { page: 0, x: 0, y: 0, w: 5000, h: 10_000, style: "fill" }
    const { issue, evidenceId, jpeg, outcomes } = await publishedWithPhoto({
      decision: "redact",
      boxes: JSON.stringify([box]),
    })
    expect(outcomes).toEqual(["published"])
    const json = await (
      await app.request(`${ORIGIN}/api/v1/isu/${issue}`)
    ).json()
    const src = json.issue.evidence[0]?.media?.[0]?.src as string | undefined
    if (!src) throw new Error("no public media")
    const media = await app.request(src)
    expect(media.status).toBe(200)
    const { data, info } = await sharp(Buffer.from(await media.arrayBuffer()))
      .raw()
      .toBuffer({ resolveWithObject: true })
    const pixel = (x: number) => {
      const at = (Math.floor(info.height / 2) * info.width + x) * info.channels
      return [data[at] ?? 0, data[at + 1] ?? 0, data[at + 2] ?? 0]
    }
    const distance = (a: number[], b: number[]) =>
      Math.max(...a.map((value, i) => Math.abs(value - (b[i] ?? 0))))
    // Background is #4a7f2c
    const green = [0x4a, 0x7f, 0x2c]
    // Fill style paints black
    expect(distance(pixel(Math.floor(info.width / 4)), [0, 0, 0])).toBeLessThan(
      32,
    )
    expect(
      distance(pixel(Math.floor((info.width * 3) / 4)), green),
    ).toBeLessThan(16)
    const original = await app.request(
      `${ORIGIN}/kelola/bukti/${evidenceId}/asli`,
      { headers: { cookie: admin.cookie } },
    )
    expect(original.status).toBe(200)
    expect(Buffer.from(await original.arrayBuffer()).equals(jpeg)).toBe(true)
  })

  test("[AC-OPS-07] Given a reporter's photo, when an admin decides it must not be published and its issue is published, then no public copy is made and the issue JSON lists no media for it", async () => {
    const before = await publicFiles()
    const { issue, outcomes } = await publishedWithPhoto({
      decision: "withhold",
    })
    expect(outcomes).not.toContain("published")
    expect(await publicFiles()).toEqual(before)
    const res = await app.request(`${ORIGIN}/api/v1/isu/${issue}`)
    expect(res.status).toBe(200)
    const json = await res.json()
    const media = (json.issue.evidence ?? []).flatMap(
      (one: { media?: unknown[] }) => one.media ?? [],
    )
    expect(media).toEqual([])
  })

  test("[AC-OPS-02] Given a published issue with a public photo, when it is taken down, then the takedown job deletes the public file and purges the whole campus host at the CDN", async () => {
    const { issue } = await publishedWithPhoto()
    const json = await (
      await app.request(`${ORIGIN}/api/v1/isu/${issue}`)
    ).json()
    const src = json.issue.evidence[0]?.media?.[0]?.src as string
    expect((await app.request(src)).status).toBe(200)
    const row = await issueRow(su, HOST, issue)
    const removed = await postForm(
      app,
      `${ORIGIN}/kelola/isu/${issue}`,
      admin.cookie,
      {
        intent: "legal_takedown",
        decision: "remove",
        reason: "data_subject_request",
        confirm: "yes",
        version: String(row.version),
      },
    )
    expect(removed.status).toBe(303)
    const purged: unknown[] = []
    const purge = createPurgeClient({
      zoneId: "zona",
      token: "token",
      fetch: async (_url, init) => {
        purged.push(JSON.parse(String(init?.body)))
        return new Response("{}", { status: 200 })
      },
    })
    const takedown = createTakedownHandler({
      filesDir: defaultFilesDir(),
      purge,
      mediaHost: null,
      deleteVideo: async () => {},
      requirePurge: true,
    })
    const outcomes = await runQueued(
      su,
      "takedown",
      orgId,
      (data: { orgId: string; takedownId: string }) => takedown(data),
    )
    expect(outcomes).toContain("done")
    expect((await app.request(src)).status).toBe(404)
    expect(purged).toContainEqual({ hosts: [HOST] })
    const { rows } = await su.query<{ purge_status: string }>(
      "SELECT purge_status FROM takedowns WHERE org_id = $1 ORDER BY created_at DESC LIMIT 1",
      [orgId],
    )
    expect(rows[0]?.purge_status).toBe("done")
  })
})

describe("operations", () => {
  test("[AC-OPS-03] Given data past its retention, when maintenance-daily runs, then rejected reports' files go after 90 days, session IPs and rating address hashes after 30 days with the prefix count kept, and files never sent become missing", async () => {
    const owner = await signedIn(HOST, person("simpan"))
    const jpeg = await gpsJpeg()
    const rejected = await submitReport(app, HOST, owner.cookie, {
      evidence: [{ name: "a.jpg", size: jpeg.length, type: "image/jpeg" }],
    })
    const rejectedFile = rejected.evidence[0]?.id ?? ""
    await app.request(`${ORIGIN}/api/upload/${rejectedFile}`, {
      method: "POST",
      headers: { cookie: owner.cookie, origin: ORIGIN },
      body: jpeg,
    })
    await review(app, su, HOST, admin.cookie, rejected.code, {
      intent: "start_review",
    })
    await review(app, su, HOST, admin.cookie, rejected.code, {
      intent: "reject",
      reason: "standard_2",
      reasonText: "Laporan ini menuduh orang yang bisa dikenali tanpa bukti.",
    })
    await su.query(
      "UPDATE reports SET updated_at = now() - interval '91 days' WHERE public_code = $1",
      [rejected.code],
    )
    const late = await submitReport(app, HOST, owner.cookie, {
      evidence: [{ name: "b.jpg", size: 100, type: "image/jpeg" }],
    })
    await su.query(
      "UPDATE reports SET created_at = now() - interval '25 hours' WHERE public_code = $1",
      [late.code],
    )
    await su.query(
      "UPDATE sessions SET created_at = now() - interval '31 days', ip_address = '10.9.9.9' WHERE user_id = $1",
      [owner.userId],
    )
    const { rows: claim } = await su.query<{ id: string }>(
      `INSERT INTO resolution_claims (org_id, issue_id)
       SELECT $1, i.id FROM issues i WHERE i.org_id = $1 LIMIT 1 RETURNING id`,
      [orgId],
    )
    const claimId = claim[0]?.id
    const { rows: people } = await su.query<{ id: string }>(
      "SELECT id FROM users LIMIT 3",
    )
    for (const [i, user] of people.entries()) {
      await su.query(
        `INSERT INTO ratings (org_id, claim_id, user_id, score, is_reporter, account_days, client_hash, created_at)
         VALUES ($1, $2, $3, 3, false, 40, 'samaprefiks', now() - interval '31 days' - make_interval(mins => $4))`,
        [orgId, claimId, user.id, i],
      )
    }
    await createMaintenanceHandler({ filesDir: defaultFilesDir() })()
    expect(
      await Bun.file(
        originalPath(defaultFilesDir(), orgId, rejectedFile),
      ).exists(),
    ).toBe(false)
    const files = await su.query("SELECT 1 FROM evidence WHERE id = $1", [
      rejectedFile,
    ])
    expect(files.rowCount).toBe(0)
    const missing = await su.query<{ status: string }>(
      "SELECT status FROM evidence WHERE id = $1",
      [late.evidence[0]?.id],
    )
    expect(missing.rows[0]?.status).toBe("missing")
    const ips = await su.query<{ ip_address: string | null }>(
      "SELECT ip_address FROM sessions WHERE user_id = $1",
      [owner.userId],
    )
    expect(ips.rows.every((row) => row.ip_address === null)).toBe(true)
    const hashes = await su.query<{ n: number; kept: number }>(
      `SELECT count(*) FILTER (WHERE client_hash IS NOT NULL)::int AS n,
         (SELECT max_prefix_ratings FROM resolution_claims WHERE id = $1) AS kept
       FROM ratings WHERE claim_id = $1`,
      [claimId],
    )
    expect(hashes.rows[0]).toEqual({ n: 0, kept: people.length })
  })

  test("[AC-OPS-04] Given requests with search words and client addresses, when they are logged, then each request line holds the path without the query and no client address", async () => {
    const before = app.lines.length
    await app.request(`${ORIGIN}/isu?q=rahasia+warga`, {
      headers: { "x-client-ip": "10.77.66.55" },
    })
    await app.request(`${ORIGIN}/kelola`, {
      headers: { "x-client-ip": "10.77.66.55" },
    })
    const lines = app.lines.slice(before)
    const requests = lines.filter((line) => line.msg === "request")
    expect(requests.map((line) => line.path)).toEqual(["/isu", "/kelola"])
    const text = JSON.stringify(lines)
    expect(text).not.toContain("rahasia")
    expect(text).not.toContain("10.77.66.55")
    expect(requests.map((line) => line.status)).toEqual([200, 403])
  })

  test("[AC-OPS-05] Given GlitchTip reporting is on, when a worker job fails with an error quoting an email, a phone number and an address, then GlitchTip receives the error without them", async () => {
    const sent: string[] = []
    const real = globalThis.fetch
    const fake = async (
      input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ) => {
      const url = input instanceof Request ? input.url : String(input)
      if (url.startsWith("https://glitchtip.contoh.id/")) {
        sent.push(String(init?.body ?? ""))
        return new Response("{}", { status: 200 })
      }
      // Email provider boundary fails
      if (url.endsWith("/api/v1/send")) {
        throw new Error(
          "gagal kirim ke warga.rahasia@contoh.id nomor +6281234567890 dari 10.20.30.40",
        )
      }
      return real(input, init)
    }
    // Other files' leftovers stay unrun
    await su.query(
      "DELETE FROM pgboss.job WHERE name = 'email-send' AND state IN ('created', 'retry')",
    )
    const owner = await signedIn(HOST, person("gagal"))
    // Receipt mail queued over HTTP
    await submitReport(app, HOST, owner.cookie)
    const receipts = await queued(su, "email-send", orgId)
    expect(receipts).toHaveLength(1)
    globalThis.fetch = Object.assign(fake, { preconnect: real.preconnect })
    const exits: number[] = []
    try {
      const worker = await startWorker(
        {
          WORKER_QUEUES: "email-send",
          DATABASE_URL: testUrl("TEST_DATABASE_URL"),
          ERROR_REPORTING: "true",
          GLITCHTIP_DSN:
            "https://0123456789abcdef0123456789abcdef@glitchtip.contoh.id/7",
        },
        {
          connect: (profile, url) => createDatabase(url, profile),
          exit: (code) => void exits.push(code),
          selfCheckMs: 60_000,
          deadMs: 600_000,
        },
      )
      // pg-boss polls every 2 s
      for (let i = 0; i < 200 && sent.length === 0; i++) await Bun.sleep(50)
      await worker.stop("test")
    } finally {
      setErrorReporter(undefined)
      globalThis.fetch = real
    }
    expect(exits).toEqual([0])
    const { rows } = await su.query<{ state: string }>(
      "SELECT state FROM pgboss.job WHERE name = 'email-send' AND id = $1",
      [receipts[0]?.id],
    )
    expect(rows.map((row) => row.state)).toEqual(["retry"])
    expect(sent).toHaveLength(1)
    const body = sent[0] ?? ""
    expect(body).toContain("email-send")
    expect(body).not.toContain("warga.rahasia@contoh.id")
    expect(body).not.toContain("6281234567890")
    expect(body).not.toContain("10.20.30.40")
  }, 30_000)
})
