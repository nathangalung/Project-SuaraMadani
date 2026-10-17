import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import sharp from "sharp"
import type { SessionContext, TenantContext } from "../../app/context.ts"
import { database } from "../../db/client.server.ts"
import { migrate } from "../../db/migrate.ts"
import { evidence, reports } from "../../db/schema/reports.ts"
import { withTenant } from "../../db/tenant.server.ts"
import {
  insertOrg,
  insertRegions,
  insertUser,
  reportValues,
  resetData,
  superuserPool,
  testUrl,
} from "../../db/testing.ts"
import { originalPath } from "../files.server.ts"
import {
  clientKey,
  createUploadHandler,
  type UploadDeps,
} from "./upload.server.ts"

const su = superuserPool()
let filesDir = ""
let orgA = ""
let orgB = ""
let userA = ""
let userB = ""
let reportA = ""
let png = new Uint8Array(new ArrayBuffer(0))

function tenant(id: string, settings = {}): TenantContext {
  return {
    id,
    slug: "x",
    host: "x.localhost",
    name: "x",
    campusCode: "X",
    campusName: "x",
    theme: {},
    settings,
  }
}

function session(userId: string): SessionContext {
  const at = new Date()
  return {
    user: {
      id: userId,
      email: "a@b.id",
      emailVerified: true,
      phoneVerified: true,
      name: "",
      twoFactorEnabled: false,
      updatedAt: at,
    },
    session: { id: "s", createdAt: at, expiresAt: at },
  }
}

async function addEvidence(
  kind: "image" | "pdf" | "video",
  declaredSize: number,
  position: number,
  reportId = reportA,
): Promise<string> {
  const [row] = await withTenant(
    orgA,
    (tx) =>
      tx
        .insert(evidence)
        .values({
          orgId: orgA,
          reportId,
          position,
          kind,
          declaredName: `f${position}`,
          declaredType: DECLARED[kind],
          declaredSize,
        })
        .returning({ id: evidence.id }),
    { role: "reporter" },
  )
  if (!row) throw new Error("no evidence row")
  return row.id
}

async function row(id: string) {
  const { rows } = await su.query<{
    status: string
    detected_type: string | null
    byte_size: string | null
    sha256: string | null
  }>(
    "SELECT status, detected_type, byte_size, sha256 FROM evidence WHERE id = $1",
    [id],
  )
  return rows[0]
}

const DECLARED = {
  image: "image/png",
  pdf: "application/pdf",
  video: "video/mp4",
} as const

/** ftyp box with brands. */
function ftyp(major: string, compatible: string[]): Uint8Array<ArrayBuffer> {
  const size = 16 + compatible.length * 4
  const box = Buffer.alloc(size + 64)
  box.writeUInt32BE(size, 0)
  box.write(`ftyp${major}`, 4, "latin1")
  for (const [i, brand] of compatible.entries()) {
    box.write(brand, 16 + i * 4, "latin1")
  }
  return new Uint8Array(box)
}

async function jobsFor(id: string, queue = "evidence"): Promise<number> {
  const { rows } = await su.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM pgboss.job WHERE name = $2 AND data->>'evidenceId' = $1",
    [id, queue],
  )
  return rows[0]?.n ?? 0
}

function handler(overrides: Partial<UploadDeps> = {}) {
  return createUploadHandler({
    filesDir,
    now: () => new Date(),
    maxConcurrent: 4,
    maxPerIp: 3,
    intakePaused: false,
    tenantDailyBytes: 10 * 1024 ** 3,
    ...overrides,
  })
}

function upload(
  id: string,
  body: Uint8Array<ArrayBuffer> | string,
  opts: { user?: string | null; org?: TenantContext; deps?: UploadDeps } = {},
) {
  const receive = handler(opts.deps)
  return receive({
    request: new Request(`http://x.localhost/api/upload/${id}`, {
      method: "POST",
      body,
    }),
    evidenceId: id,
    tenant: opts.org ?? tenant(orgA),
    session: opts.user === null ? null : session(opts.user ?? userA),
  })
}

beforeAll(async () => {
  await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
  await resetData(su)
  await insertRegions(su)
  orgA = await insertOrg(su, "upa")
  orgB = await insertOrg(su, "upb")
  userA = await insertUser(su, "pelapor.a@contoh.id")
  userB = await insertUser(su, "pelapor.b@contoh.id")
  const [report] = await withTenant(orgA, (tx) =>
    tx
      .insert(reports)
      .values(reportValues(orgA, userA))
      .returning({ id: reports.id }),
  )
  reportA = report?.id ?? ""
  filesDir = await mkdtemp(join(tmpdir(), "sm-upload-"))
  png = new Uint8Array(
    await sharp({
      create: { width: 4, height: 4, channels: 3, background: "#0f55d6" },
    })
      .png()
      .toBuffer(),
  )
  await database().boss.start()
})

afterAll(async () => {
  await rm(filesDir, { recursive: true, force: true })
  await resetData(su)
  await su.end()
})

async function orgFiles(): Promise<string[]> {
  try {
    return await readdir(join(filesDir, "evidence", orgA))
  } catch {
    return []
  }
}

describe("access", () => {
  test("no session is 401", async () => {
    const id = await addEvidence("image", 1000, 0)
    expect((await upload(id, png, { user: null })).status).toBe(401)
  })

  test("another user's evidence is 404", async () => {
    const id = await addEvidence("image", 1000, 1)
    expect((await upload(id, png, { user: userB })).status).toBe(404)
    expect((await row(id))?.status).toBe("awaiting_upload")
  })

  test("another tenant cannot see the row", async () => {
    const id = await addEvidence("image", 1000, 2)
    expect((await upload(id, png, { org: tenant(orgB) })).status).toBe(404)
  })

  test("a forwarded or rejected report takes no upload", async () => {
    for (const status of ["forwarded", "rejected"]) {
      const [closed] = await withTenant(orgA, (tx) =>
        tx
          .insert(reports)
          .values(reportValues(orgA, userA))
          .returning({ id: reports.id }),
      )
      await su.query(
        "UPDATE reports SET status = $2, forwarded_to_org_id = CASE WHEN $2 = 'forwarded' THEN $3::uuid END WHERE id = $1",
        [closed?.id, status, orgB],
      )
      const { rows } = await su.query<{ id: string }>(
        `INSERT INTO evidence (org_id, report_id, position, kind, declared_name,
           declared_type, declared_size) VALUES ($1, $2, 0, 'image', 'a.png',
           'image/png', 1000) RETURNING id`,
        [orgA, closed?.id],
      )
      const id = rows[0]?.id ?? ""
      expect([status, (await upload(id, png)).status]).toEqual([status, 409])
      expect((await row(id))?.status).toBe("awaiting_upload")
    }
  })

  test("a malformed id is 404", async () => {
    expect((await upload("not-a-uuid", png)).status).toBe(404)
  })
})

describe("limits", () => {
  test("a non-image body is 415 and leaves no file", async () => {
    const id = await addEvidence("image", 1000, 3)
    const res = await upload(id, "just some text, not an image at all")
    expect(res.status).toBe(415)
    expect((await row(id))?.status).toBe("awaiting_upload")
    expect(await orgFiles()).not.toContain(id)
    expect((await orgFiles()).filter((f) => f.startsWith("."))).toEqual([])
  })

  test("more bytes than the manifest entry is 413", async () => {
    const id = await addEvidence("image", png.byteLength - 1, 4)
    const res = await upload(id, png)
    expect(res.status).toBe(413)
    expect((await row(id))?.status).toBe("awaiting_upload")
    expect((await orgFiles()).filter((f) => f.startsWith("."))).toEqual([])
  })
})

describe("receive", () => {
  let id = ""

  test("stores, hashes, marks received and enqueues once", async () => {
    await su.query("DELETE FROM evidence WHERE report_id = $1", [reportA])
    id = await addEvidence("image", png.byteLength, 0)
    const res = await upload(id, png)
    expect(res.status).toBe(201)
    const stored = await row(id)
    expect(stored?.status).toBe("received")
    expect(stored?.detected_type).toBe("image/png")
    expect(Number(stored?.byte_size)).toBe(png.byteLength)
    expect(stored?.sha256).toBe(createHash("sha256").update(png).digest("hex"))
    const file = Bun.file(originalPath(filesDir, orgA, id))
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(png)
    expect(await jobsFor(id)).toBe(1)
  })

  test("a repeated upload writes nothing", async () => {
    const res = await upload(id, png)
    expect(res.status).toBe(200)
    expect(await jobsFor(id)).toBe(1)
  })

  test("parallel uploads of one id: one winner, loser writes nothing", async () => {
    const raced = await addEvidence("image", 100_000, 1)
    const other = new Uint8Array(
      await sharp({
        create: { width: 5, height: 5, channels: 3, background: "#ff0000" },
      })
        .png()
        .toBuffer(),
    )
    // Both pass the first check
    const slow = (bytes: Uint8Array<ArrayBuffer>) =>
      new ReadableStream<Uint8Array>({
        async start(controller) {
          await Bun.sleep(150)
          controller.enqueue(bytes)
          controller.close()
        },
      })
    const receive = handler()
    const send = (bytes: Uint8Array<ArrayBuffer>) =>
      receive({
        request: new Request(`http://x.localhost/api/upload/${raced}`, {
          method: "POST",
          body: slow(bytes),
          duplex: "half",
        } as RequestInit),
        evidenceId: raced,
        tenant: tenant(orgA),
        session: session(userA),
      })
    const results = await Promise.all([send(png), send(other)])
    expect(results.map((r) => r.status).sort()).toEqual([200, 201])
    expect(await jobsFor(raced)).toBe(1)
    const stored = await Bun.file(originalPath(filesDir, orgA, raced)).bytes()
    expect(createHash("sha256").update(stored).digest("hex")).toBe(
      (await row(raced))?.sha256 ?? "",
    )
    expect(
      (await orgFiles()).filter((name) => name.startsWith(".tmp")),
    ).toEqual([]) // Frees position 1
    await su.query("DELETE FROM evidence WHERE id = $1", [raced])
  })

  test("a body must match its row kind", async () => {
    const pdf = await addEvidence("pdf", 1000, 1)
    expect((await upload(pdf, png)).status).toBe(415)
    expect((await row(pdf))?.status).toBe("awaiting_upload")
    await su.query("DELETE FROM evidence WHERE id = $1", [pdf])
  })
})

describe("every evidence type", () => {
  let other = ""
  const add = (kind: "image" | "pdf" | "video", size: number, at: number) =>
    addEvidence(kind, size, at, other)
  const pdfBytes = new Uint8Array(
    Buffer.from("%PDF-1.4\n1 0 obj << >> endobj\n%%EOF\n", "latin1"),
  )

  test("a PDF goes to the evidence queue", async () => {
    const [report] = await withTenant(orgA, (tx) =>
      tx
        .insert(reports)
        .values(reportValues(orgA, userA))
        .returning({ id: reports.id }),
    )
    other = report?.id ?? ""
    const id = await add("pdf", pdfBytes.byteLength, 0)
    expect((await upload(id, pdfBytes)).status).toBe(201)
    expect((await row(id))?.detected_type).toBe("application/pdf")
    expect(await jobsFor(id)).toBe(1)
  })

  test("HEIC from an iPhone is accepted", async () => {
    const heic = ftyp("heic", ["mif1", "heic"])
    const id = await add("image", heic.byteLength, 1)
    expect((await upload(id, heic)).status).toBe(201)
    expect((await row(id))?.detected_type).toBe("image/heic")
    expect(await jobsFor(id)).toBe(1)
  })

  test("an HEIC sequence is refused", async () => {
    const sequence = ftyp("hevc", ["msf1", "hevc"])
    const id = await add("image", sequence.byteLength, 2)
    expect((await upload(id, sequence)).status).toBe(415)
  })

  test("video gets its own queue and a 50 MB cap", async () => {
    const MB = 1024 * 1024
    const mp4 = new Uint8Array(new ArrayBuffer(12 * MB))
    mp4.set(ftyp("isom", ["isom", "mp41"]).subarray(0, 24))
    const id = await add("video", mp4.byteLength, 3)
    expect((await upload(id, mp4)).status).toBe(201)
    expect((await row(id))?.detected_type).toBe("video/mp4")
    expect(await jobsFor(id, "evidence-video")).toBe(1)
    expect(await jobsFor(id)).toBe(0)
  })

  test("an image stays under 10 MB", async () => {
    const MB = 1024 * 1024
    const big = new Uint8Array(new ArrayBuffer(10 * MB + 1))
    big.set(png)
    const id = await add("image", 11 * MB, 4)
    expect((await upload(id, big)).status).toBe(413)
  })
})

describe("clientKey", () => {
  test("IPv6 groups by /64, IPv4-mapped unwraps", () => {
    for (const [ip, key] of [
      ["2001:db8::1", "2001:db8:0:0"],
      ["2001:db8::2", "2001:db8:0:0"],
      ["2001:DB8:0:0:aaaa::1", "2001:db8:0:0"],
      ["2001:0db8:0000:0000:ffff::", "2001:db8:0:0"],
      ["fe80::1%eth0", "fe80:0:0:0"],
      ["::", "0:0:0:0"],
      ["::ffff:1.2.3.4", "1.2.3.4"],
      ["::ffff:0102:0304", "1.2.3.4"],
      ["203.0.113.7", "203.0.113.7"],
      ["not an ip", "unknown"],
      [null, "unknown"],
    ] as const) {
      expect([ip, clientKey(ip)]).toEqual([ip, key])
    }
  })
})

describe("window and capacity", () => {
  test("after 24 h the window is closed", async () => {
    const id = await addEvidence("image", 1000, 2)
    await su.query(
      "UPDATE reports SET created_at = now() - interval '25 hours' WHERE id = $1",
      [reportA],
    )
    try {
      expect((await upload(id, png)).status).toBe(410)
    } finally {
      await su.query("UPDATE reports SET created_at = now() WHERE id = $1", [
        reportA,
      ])
    }
  })

  test("intake pause is 503", async () => {
    const id = await addEvidence("image", 1000, 3)
    const paused = await upload(id, png, {
      org: tenant(orgA, { intakePaused: true }),
    })
    expect(paused.status).toBe(503)
  })

  test("full slots are 503 with Retry-After", async () => {
    const id = await addEvidence("image", 1000, 4)
    const res = await upload(id, png, {
      deps: {
        filesDir,
        now: () => new Date(),
        maxConcurrent: 0,
        maxPerIp: 3,
        intakePaused: false,
        tenantDailyBytes: 10 * 1024 ** 3,
      },
    })
    expect(res.status).toBe(503)
    expect(res.headers.get("Retry-After")).toBe("30")
  })

  test("the tenant byte cap fails closed", async () => {
    const id = await addEvidence("image", 1000, 4).catch(async () => {
      await su.query(
        "DELETE FROM evidence WHERE report_id = $1 AND position = 4",
        [reportA],
      )
      return addEvidence("image", 1000, 4)
    })
    const res = await upload(id, png, {
      deps: {
        filesDir,
        now: () => new Date(),
        maxConcurrent: 4,
        maxPerIp: 3,
        intakePaused: false,
        tenantDailyBytes: 1,
      },
    })
    expect(res.status).toBe(503)
  })
})
