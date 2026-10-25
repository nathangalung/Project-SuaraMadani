import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readdir, rm, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
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
import { timed } from "../../db/timing.server.ts"
import { EVIDENCE_LIMITS } from "../../shared/report-fields.ts"
import { originalPath, partPath } from "../files.server.ts"
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
  filesDir = await mkdtemp(join(tmpdir(), "sb-upload-"))
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
    expect(await orgFiles()).not.toContain(id)
    expect((await orgFiles()).filter((f) => f.startsWith("."))).toEqual([])
  })
})

describe("a client that cannot be cancelled", () => {
  test("Given a body past the manifest size whose cancel fails, then the answer is still 413 and no file is left", async () => {
    const [report] = await withTenant(orgA, (tx) =>
      tx
        .insert(reports)
        .values(reportValues(orgA, userA))
        .returning({ id: reports.id }),
    )
    const id = await addEvidence("image", 1000, 0, report?.id)
    const res = await handler()({
      request: new Request(`http://x.localhost/api/upload/${id}`, {
        method: "POST",
        body: new ReadableStream<Uint8Array>({
          pull(controller) {
            controller.enqueue(png)
          },
          cancel() {
            throw new Error("socket gone")
          },
        }),
        duplex: "half",
      } as RequestInit),
      evidenceId: id,
      tenant: tenant(orgA),
      session: session(userA),
    })
    expect(res.status).toBe(413)
    expect((await row(id))?.status).toBe("awaiting_upload")
    expect(await orgFiles()).not.toContain(id)
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

describe("resumable upload, tus 1.0", () => {
  const TUS = { "Tus-Resumable": "1.0.0" }
  const OCTETS = "application/offset+octet-stream"
  // filesDir is set in beforeAll
  let receive = handler()
  beforeAll(() => {
    receive = handler()
  })

  async function freshReport(): Promise<string> {
    const [report] = await withTenant(orgA, (tx) =>
      tx
        .insert(reports)
        .values(reportValues(orgA, userA))
        .returning({ id: reports.id }),
    )
    return report?.id ?? ""
  }

  /** Padded MP4 header, sniffable. */
  function mp4(size: number): Uint8Array<ArrayBuffer> {
    const bytes = new Uint8Array(new ArrayBuffer(size))
    bytes.set(ftyp("isom", ["isom", "mp41"]).subarray(0, 24))
    for (let i = 24; i < size; i++) bytes[i] = i % 251
    return bytes
  }

  type Send = {
    method?: string
    body?: BodyInit
    headers?: Record<string, string>
    user?: string | null
    org?: TenantContext
    with?: ReturnType<typeof handler>
  }

  function send(id: string, opts: Send = {}) {
    const method = opts.method ?? "HEAD"
    const stream = opts.body instanceof ReadableStream
    return (opts.with ?? receive)({
      request: new Request(`http://x.localhost/api/upload/${id}`, {
        method,
        headers: opts.headers ?? TUS,
        body: opts.body,
        ...(stream ? { duplex: "half" } : {}),
      } as RequestInit),
      evidenceId: id,
      tenant: opts.org ?? tenant(orgA),
      session: opts.user === null ? null : session(opts.user ?? userA),
    })
  }

  const patch = (id: string, offset: number, body: BodyInit, extra = {}) =>
    send(id, {
      method: "PATCH",
      body,
      headers: {
        ...TUS,
        "Content-Type": OCTETS,
        "Upload-Offset": String(offset),
        ...extra,
      },
    })

  const head = async (id: string) => {
    const res = await send(id)
    return {
      status: res.status,
      offset: res.headers.get("Upload-Offset"),
      length: res.headers.get("Upload-Length"),
    }
  }

  async function part(id: string): Promise<number | null> {
    const file = Bun.file(partPath(filesDir, orgA, id))
    return (await file.exists()) ? file.size : null
  }

  test("OPTIONS names the version and size cap", async () => {
    const id = await addEvidence("video", 10_000, 0, await freshReport())
    const res = await send(id, { method: "OPTIONS", headers: {} })
    expect(res.status).toBe(204)
    expect(res.headers.get("Tus-Version")).toBe("1.0.0")
    expect(res.headers.get("Tus-Max-Size")).toBe(String(EVIDENCE_LIMITS.video))
    expect(res.headers.has("Tus-Extension")).toBe(false)
  })

  test("a missing or other version is 412", async () => {
    const id = await addEvidence("video", 10_000, 0, await freshReport())
    const versions: Record<string, string>[] = [
      {},
      { "Tus-Resumable": "0.2.2" },
    ]
    for (const headers of versions) {
      const res = await send(id, { headers })
      expect(res.status).toBe(412)
      expect(res.headers.get("Tus-Version")).toBe("1.0.0")
      expect(res.headers.has("Upload-Offset")).toBe(false)
    }
    const res = await patch(id, 0, mp4(10_000), { "Tus-Resumable": "0.2.2" })
    expect(res.status).toBe(412)
    expect(await part(id)).toBeNull()
  })

  test("HEAD before any byte is offset 0", async () => {
    const id = await addEvidence("video", 10_000, 0, await freshReport())
    const res = await send(id)
    expect(res.status).toBe(200)
    expect(res.headers.get("Upload-Offset")).toBe("0")
    expect(res.headers.get("Upload-Length")).toBe("10000")
    expect(res.headers.get("Tus-Resumable")).toBe("1.0.0")
    expect(res.headers.get("Cache-Control")).toContain("no-store")
    expect(await res.text()).toBe("")
  })

  test("HEAD skips the byte cap read", async () => {
    // PERF-26: resume probes stay cheap
    const id = await addEvidence("video", 10_000, 0, await freshReport())
    const [timing, res] = await timed(() => send(id))
    expect(res.status).toBe(200)
    // BEGIN, set_config, row, COMMIT
    expect(timing.queries).toBe(4)
  })

  test("two PATCHes store, hash and enqueue once", async () => {
    const bytes = mp4(10_000)
    const id = await addEvidence(
      "video",
      bytes.byteLength,
      0,
      await freshReport(),
    )
    const first = await patch(id, 0, bytes.subarray(0, 3000))
    expect(first.status).toBe(204)
    expect(first.headers.get("Upload-Offset")).toBe("3000")
    expect(first.headers.get("Tus-Resumable")).toBe("1.0.0")
    expect(await head(id)).toEqual({
      status: 200,
      offset: "3000",
      length: "10000",
    })
    expect((await row(id))?.status).toBe("awaiting_upload")
    const second = await patch(id, 3000, bytes.subarray(3000))
    expect(second.status).toBe(204)
    expect(second.headers.get("Upload-Offset")).toBe("10000")
    const stored = await row(id)
    expect(stored?.status).toBe("received")
    expect(stored?.detected_type).toBe("video/mp4")
    expect(Number(stored?.byte_size)).toBe(10_000)
    expect(stored?.sha256).toBe(
      createHash("sha256").update(bytes).digest("hex"),
    )
    expect(await Bun.file(originalPath(filesDir, orgA, id)).bytes()).toEqual(
      bytes,
    )
    expect(await part(id)).toBeNull()
    expect(await jobsFor(id, "evidence-video")).toBe(1)
    // Lost response, client asks again
    expect(await head(id)).toEqual({
      status: 200,
      offset: "10000",
      length: "10000",
    })
    expect((await patch(id, 10_000, new Uint8Array(0))).status).toBe(204)
    expect(await jobsFor(id, "evidence-video")).toBe(1)
  })

  test("a wrong offset is 409 and changes nothing", async () => {
    const bytes = mp4(10_000)
    const id = await addEvidence(
      "video",
      bytes.byteLength,
      0,
      await freshReport(),
    )
    expect((await patch(id, 0, bytes.subarray(0, 5000))).status).toBe(204)
    expect((await patch(id, 4000, bytes.subarray(4000))).status).toBe(409)
    expect((await patch(id, 0, bytes)).status).toBe(409)
    expect(await part(id)).toBe(5000)
  })

  test("bad headers are refused before any write", async () => {
    const id = await addEvidence("video", 10_000, 0, await freshReport())
    const body = mp4(10_000)
    const wrongType = await send(id, {
      method: "PATCH",
      body,
      headers: { ...TUS, "Upload-Offset": "0", "Content-Type": "video/mp4" },
    })
    expect(wrongType.status).toBe(415)
    for (const offset of ["", "-1", "1e3", "abc"]) {
      const res = await send(id, {
        method: "PATCH",
        body,
        headers: { ...TUS, "Content-Type": OCTETS, "Upload-Offset": offset },
      })
      expect([offset, res.status]).toEqual([offset, 400])
    }
    expect(await part(id)).toBeNull()
  })

  test("bytes past the length are 413, offset kept", async () => {
    const bytes = mp4(10_000)
    const id = await addEvidence("video", 8000, 0, await freshReport())
    expect((await patch(id, 0, bytes.subarray(0, 5000))).status).toBe(204)
    const declared = await patch(id, 5000, bytes.subarray(5000), {
      "Content-Length": "5000",
    })
    expect(declared.status).toBe(413)
    // No length header, streamed
    const streamed = await send(id, {
      method: "PATCH",
      body: new ReadableStream<Uint8Array>({
        // First chunk fits, second overflows
        start(controller) {
          controller.enqueue(bytes.slice(5000, 7000))
          controller.enqueue(bytes.slice(7000))
          controller.close()
        },
      }),
      headers: { ...TUS, "Content-Type": OCTETS, "Upload-Offset": "5000" },
    })
    expect(streamed.status).toBe(413)
    expect(await part(id)).toBe(5000)
    expect((await row(id))?.status).toBe("awaiting_upload")
  })

  test("a wrong file type is 415 and drops the part", async () => {
    const id = await addEvidence("image", 10_000, 0, await freshReport())
    const text = new TextEncoder().encode("not an image ".repeat(700))
    const res = await patch(id, 0, text.subarray(0, 5000))
    expect(res.status).toBe(415)
    expect(await part(id)).toBeNull()
    expect(await head(id)).toEqual({
      status: 200,
      offset: "0",
      length: "10000",
    })
  })

  test("a dropped connection keeps its bytes", async () => {
    const bytes = mp4(10_000)
    const id = await addEvidence(
      "video",
      bytes.byteLength,
      0,
      await freshReport(),
    )
    let sent = false
    const res = await send(id, {
      method: "PATCH",
      body: new ReadableStream<Uint8Array>({
        // error() drops queued chunks
        pull(controller) {
          if (sent) controller.error(new Error("connection reset"))
          else controller.enqueue(bytes.slice(0, 6000))
          sent = true
        },
      }),
      headers: { ...TUS, "Content-Type": OCTETS, "Upload-Offset": "0" },
    })
    expect(res.status).toBe(408)
    expect((await head(id)).offset).toBe("6000")
    expect((await patch(id, 6000, bytes.subarray(6000))).status).toBe(204)
    expect((await row(id))?.sha256).toBe(
      createHash("sha256").update(bytes).digest("hex"),
    )
  })

  test("a disk fault is a server error", async () => {
    const bytes = mp4(10_000)
    const id = await addEvidence(
      "video",
      bytes.byteLength,
      0,
      await freshReport(),
    )
    // Every write fails ENOSPC
    const path = partPath(filesDir, orgA, id)
    await mkdir(dirname(path), { recursive: true })
    await symlink("/dev/full", path)
    try {
      await expect(patch(id, 0, bytes)).rejects.toMatchObject({
        code: "ENOSPC",
      })
    } finally {
      await rm(path, { force: true })
    }
  })

  test("a new PATCH takes over a stalled one", async () => {
    const bytes = mp4(10_000)
    const id = await addEvidence(
      "video",
      bytes.byteLength,
      0,
      await freshReport(),
    )
    // Sends 4000 bytes, then hangs
    const stalled = send(id, {
      method: "PATCH",
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes.slice(0, 4000))
        },
      }),
      headers: { ...TUS, "Content-Type": OCTETS, "Upload-Offset": "0" },
    })
    for (let i = 0; i < 100 && (await part(id)) !== 4000; i++) {
      await Bun.sleep(10)
    }
    expect(await part(id)).toBe(4000)
    const resumed = await patch(id, 4000, bytes.subarray(4000))
    expect(resumed.status).toBe(204)
    expect(resumed.headers.get("Upload-Offset")).toBe("10000")
    expect((await stalled).status).toBe(423)
    expect((await row(id))?.status).toBe("received")
  })

  /** Overflows, refuses cancel. */
  function stubborn(chunks: Uint8Array[], close: boolean) {
    return new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk)
        if (close) controller.close()
      },
      cancel() {
        throw new Error("socket gone")
      },
    })
  }

  test("Given bytes past the length whose cancel fails, then the PATCH is still 413 and the offset kept", async () => {
    const bytes = mp4(10_000)
    const id = await addEvidence("video", 8000, 0, await freshReport())
    expect((await patch(id, 0, bytes.subarray(0, 5000))).status).toBe(204)
    const res = await send(id, {
      method: "PATCH",
      body: stubborn([bytes.slice(5000, 7000), bytes.slice(7000)], false),
      headers: { ...TUS, "Content-Type": OCTETS, "Upload-Offset": "5000" },
    })
    expect(res.status).toBe(413)
    expect(await part(id)).toBe(5000)
    expect((await row(id))?.status).toBe("awaiting_upload")
  })

  test("Given a stalled PATCH whose cancel fails, when a new PATCH takes over, then both answer and the file completes", async () => {
    const bytes = mp4(10_000)
    const id = await addEvidence(
      "video",
      bytes.byteLength,
      0,
      await freshReport(),
    )
    const stalled = send(id, {
      method: "PATCH",
      body: stubborn([bytes.slice(0, 4000)], false),
      headers: { ...TUS, "Content-Type": OCTETS, "Upload-Offset": "0" },
    })
    for (let i = 0; i < 100 && (await part(id)) !== 4000; i++) {
      await Bun.sleep(10)
    }
    expect(await part(id)).toBe(4000)
    expect((await patch(id, 4000, bytes.subarray(4000))).status).toBe(204)
    expect((await stalled).status).toBe(423)
    expect((await row(id))?.status).toBe("received")
  })

  test("Given a full part that is not the declared type, when HEAD resumes it, then the part is dropped and the upload restarts at 0", async () => {
    const bytes = mp4(10_000)
    const id = await addEvidence(
      "video",
      bytes.byteLength,
      0,
      await freshReport(),
    )
    // Corrupt part after a crash
    const path = partPath(filesDir, orgA, id)
    await mkdir(dirname(path), { recursive: true })
    await Bun.write(path, new Uint8Array(bytes.byteLength))
    expect(await head(id)).toEqual({
      status: 200,
      offset: "0",
      length: "10000",
    })
    expect(await part(id)).toBeNull()
    expect((await row(id))?.status).toBe("awaiting_upload")
    expect((await patch(id, 0, bytes)).status).toBe(204)
    expect((await row(id))?.status).toBe("received")
  })

  test("POST with the method override acts as PATCH", async () => {
    const bytes = mp4(10_000)
    const id = await addEvidence(
      "video",
      bytes.byteLength,
      0,
      await freshReport(),
    )
    const res = await send(id, {
      method: "POST",
      body: bytes,
      headers: {
        ...TUS,
        "X-HTTP-Method-Override": "PATCH",
        "Content-Type": OCTETS,
        "Upload-Offset": "0",
      },
    })
    expect(res.status).toBe(204)
    expect(res.headers.get("Upload-Offset")).toBe("10000")
    expect((await row(id))?.status).toBe("received")
  })

  test("only the signed-in owner sees the upload", async () => {
    const id = await addEvidence("video", 10_000, 0, await freshReport())
    expect((await send(id, { user: null })).status).toBe(401)
    for (const res of [
      await send(id, { user: userB }),
      await send(id, { org: tenant(orgB) }),
      await send("not-a-uuid"),
    ]) {
      expect(res.status).toBe(404)
      expect(res.headers.has("Upload-Offset")).toBe(false)
    }
    expect((await patch(id, 0, mp4(10_000))).status).toBe(204)
    const foreign = await send(id, {
      method: "PATCH",
      user: userB,
      body: new Uint8Array(10),
      headers: { ...TUS, "Content-Type": OCTETS, "Upload-Offset": "10000" },
    })
    expect(foreign.status).toBe(404)
  })

  test("closed reports and missing files end the upload", async () => {
    const report = await freshReport()
    const missing = await addEvidence("video", 10_000, 0, report)
    await su.query("UPDATE evidence SET status = 'missing' WHERE id = $1", [
      missing,
    ])
    expect((await head(missing)).status).toBe(410)
    const closed = await addEvidence("video", 10_000, 1, report)
    await su.query("UPDATE reports SET status = 'rejected' WHERE id = $1", [
      report,
    ])
    expect((await head(closed)).status).toBe(403)
    expect((await patch(closed, 0, mp4(10_000))).status).toBe(403)
    expect(await part(closed)).toBeNull()
  })

  test("PATCH needs a slot, HEAD does not", async () => {
    const id = await addEvidence("video", 10_000, 0, await freshReport())
    const full = handler({ maxConcurrent: 0 })
    const busy = await send(id, {
      with: full,
      method: "PATCH",
      body: mp4(10_000),
      headers: { ...TUS, "Content-Type": OCTETS, "Upload-Offset": "0" },
    })
    expect(busy.status).toBe(503)
    expect(busy.headers.get("Retry-After")).toBe("30")
    expect((await send(id, { with: full })).status).toBe(200)
  })

  test("a single POST finishes a started part", async () => {
    const bytes = mp4(10_000)
    const id = await addEvidence(
      "video",
      bytes.byteLength,
      0,
      await freshReport(),
    )
    expect((await patch(id, 0, bytes.subarray(0, 3000))).status).toBe(204)
    expect((await upload(id, bytes)).status).toBe(201)
    expect(await part(id)).toBeNull()
    expect(await head(id)).toEqual({
      status: 200,
      offset: "10000",
      length: "10000",
    })
  })

  test("two HEADs on a full part both give the offset", async () => {
    const bytes = mp4(10_000)
    const id = await addEvidence(
      "video",
      bytes.byteLength,
      0,
      await freshReport(),
    )
    // Earlier commit failed, part full
    const path = partPath(filesDir, orgA, id)
    await mkdir(dirname(path), { recursive: true })
    await Bun.write(path, bytes)
    const full = { status: 200, offset: "10000", length: "10000" }
    expect(await Promise.all([head(id), head(id)])).toEqual([full, full])
    expect((await row(id))?.status).toBe("received")
    expect(await jobsFor(id, "evidence-video")).toBe(1)
  })

  test("started parts count towards the tenant byte cap", async () => {
    // Own campus, no committed bytes
    const org = await insertOrg(su, "upcap")
    const [report] = await withTenant(org, (tx) =>
      tx
        .insert(reports)
        .values(reportValues(org, userA))
        .returning({ id: reports.id }),
    )
    const { rows } = await su.query<{ id: string }>(
      `INSERT INTO evidence (org_id, report_id, position, kind, declared_name,
         declared_type, declared_size)
       SELECT $1, $2, g, 'video', 'v.mp4', 'video/mp4', 10000
       FROM generate_series(0, 2) g ORDER BY g RETURNING id`,
      [org, report?.id],
    )
    const [first = "", second = "", third = ""] = rows.map((r) => r.id)
    const bytes = mp4(10_000)
    const at = (
      id: string,
      cap: number,
      body: Uint8Array<ArrayBuffer>,
      offset = 0,
    ) =>
      send(id, {
        method: "PATCH",
        body,
        org: tenant(org),
        with: handler({ tenantDailyBytes: cap }),
        headers: {
          ...TUS,
          "Content-Type": OCTETS,
          "Upload-Offset": String(offset),
        },
      })
    expect(
      (await at(first, 10 * 1024 ** 3, bytes.subarray(0, 3000))).status,
    ).toBe(204)
    const capped = await at(second, 3000, bytes)
    expect(capped.status).toBe(503)
    expect(await capped.json()).toEqual({ error: "tenant_cap" })
    expect(capped.headers.get("Retry-After")).toBe("3600")
    expect(Bun.file(partPath(filesDir, org, second)).size).toBe(0)
    // Single POST counts parts too
    const post = await handler({ tenantDailyBytes: 3000 })({
      request: new Request(`http://x.localhost/api/upload/${third}`, {
        method: "POST",
        body: bytes,
      }),
      evidenceId: third,
      tenant: tenant(org),
      session: session(userA),
    })
    expect(post.status).toBe(503)
    // Own part never blocks resuming
    const resumed = await at(first, 3000, bytes.subarray(3000), 3000)
    expect(resumed.status).toBe(204)
    expect((await row(first))?.status).toBe("received")
    expect((await at(second, 10_000, bytes)).status).toBe(503)
    expect((await at(second, 10_001, bytes)).status).toBe(204)
    expect((await row(second))?.status).toBe("received")
  })

  test("other methods are 405", async () => {
    const id = await addEvidence("video", 10_000, 0, await freshReport())
    const res = await send(id, { method: "GET" })
    expect(res.status).toBe(405)
    expect(res.headers.get("Allow")).toBe("POST, PATCH, HEAD, OPTIONS")
  })
})
