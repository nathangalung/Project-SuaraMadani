import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { rm } from "node:fs/promises"
import { dirname } from "node:path"
import sharp from "sharp"
import { migrate } from "../../db/migrate.ts"
import {
  insertOrg,
  insertRegions,
  resetData,
  superuserPool,
  testUrl,
} from "../../db/testing.ts"
import {
  actionData,
  CAPTCHA_PASS,
  dropJobs,
  type FullApp,
  fullApp,
  hostsChanged,
  queued,
  signedIn,
  stubTurnstile,
} from "../../e2e/app-harness.ts"
import { CONSENT_TEXT_VERSION } from "../../shared/report-fields.ts"
import { defaultFilesDir, originalPath } from "../files.server.ts"

const HOST = "accupl.localhost"
const OTHER = "accuplb.localhost"
const ORIGIN = `http://${HOST}`
const su = superuserPool()
let app: FullApp
let orgId = ""
let otherOrg = ""
let restore = () => {}
let png: Uint8Array<ArrayBuffer> = new Uint8Array()
let seq = 0

type Owner = { cookie: string; userId: string }

function person(label: string) {
  seq += 1
  return {
    email: `${label}.${seq}@contoh.id`,
    phone: `+62812666${String(seq).padStart(5, "0")}`,
    name: "Pelapor Unggah",
  }
}

/** Step-7 submit, one manifest row. */
async function submitted(
  owner: Owner,
  file: { name: string; size: number; type: string },
): Promise<string> {
  const res = await app.request(`${ORIGIN}/lapor/periksa.data`, {
    method: "POST",
    headers: {
      cookie: owner.cookie,
      origin: ORIGIN,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      submissionId: crypto.randomUUID(),
      turnstileToken: CAPTCHA_PASS,
      relation: { relation: "self" },
      location: {
        provinceCode: "32",
        regencyCode: "32.73",
        districtCode: "32.73.02",
      },
      details: {
        title: "Jembatan retak di Coblong",
        story: "Retakan besar muncul di jembatan dan makin lebar setiap hari.",
        categoryId: "program",
        subcategoryId: "program.infrastruktur",
        occurredOn: "2026-10-01",
        urgency: "medium",
      },
      impact: {
        groups: ["general_public"],
        affectedCount: "11_100",
        ongoing: "yes",
      },
      evidence: [file],
      contact: { contactable: "no" },
      consent: {
        consents: {
          age_18_plus: true,
          accurate: true,
          public_issue: true,
          aggregate_processing: true,
        },
        consentTextVersion: CONSENT_TEXT_VERSION,
      },
    }),
  })
  if (res.status !== 201) throw new Error(`submit ${res.status}`)
  const body = await actionData<{ evidence: { id: string }[] }>(res)
  const id = body.evidence[0]?.id
  if (!id) throw new Error("no evidence row")
  return id
}

function upload(
  id: string,
  init: {
    method?: string
    cookie?: string
    body?: Uint8Array<ArrayBuffer>
    headers?: Record<string, string>
    host?: string
  },
) {
  const host = init.host ?? HOST
  return app.request(`http://${host}/api/upload/${id}`, {
    method: init.method ?? "POST",
    headers: {
      ...(init.cookie ? { cookie: init.cookie } : {}),
      origin: `http://${host}`,
      "x-client-ip": `10.2.0.${seq}`,
      ...init.headers,
    },
    ...(init.body ? { body: init.body } : {}),
  })
}

const tus = (extra: Record<string, string> = {}) => ({
  "Tus-Resumable": "1.0.0",
  ...extra,
})

async function row(id: string) {
  const { rows } = await su.query<{
    status: string
    detected_type: string | null
    byte_size: string | null
  }>("SELECT status, detected_type, byte_size FROM evidence WHERE id = $1", [
    id,
  ])
  return rows[0]
}

beforeAll(async () => {
  await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
  await resetData(su)
  await insertRegions(su)
  orgId = await insertOrg(su, "accupl")
  otherOrg = await insertOrg(su, "accuplb")
  hostsChanged([HOST, OTHER])
  restore = stubTurnstile()
  app = await fullApp()
  // Noise keeps the PNG large
  let state = 7
  const raw = Buffer.alloc(200 * 150 * 3)
  for (let i = 0; i < raw.length; i++) {
    state = (state * 1_103_515_245 + 12_345) % 2 ** 31
    raw[i] = state >> 23
  }
  png = new Uint8Array(
    await sharp(raw, { raw: { width: 200, height: 150, channels: 3 } })
      .png()
      .toBuffer(),
  )
})

afterAll(async () => {
  await dropJobs(su, [HOST, OTHER])
  // Later files rebuild auth
  hostsChanged([HOST, OTHER])
  restore()
  const dir = dirname(originalPath(defaultFilesDir(), orgId, "x"))
  await rm(dir, { recursive: true, force: true })
  await rm(dirname(originalPath(defaultFilesDir(), otherOrg, "x")), {
    recursive: true,
    force: true,
  })
  await resetData(su)
  await su.end()
})

describe("evidence upload", () => {
  test("[AC-UPLOAD-01] Given a submitted report with one declared photo, when its owner sends the file, then it is stored privately, typed from its bytes and queued for processing, and a resend stores nothing new", async () => {
    const owner = await signedIn(HOST, person("unggah"))
    const id = await submitted(owner, {
      name: "bukti.png",
      size: png.length,
      type: "image/png",
    })
    const res = await upload(id, { cookie: owner.cookie, body: png })
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ status: "received" })
    expect(await row(id)).toEqual({
      status: "received",
      detected_type: "image/png",
      byte_size: String(png.length),
    })
    const stored = Bun.file(originalPath(defaultFilesDir(), orgId, id))
    expect(stored.size).toBe(png.length)
    const jobs = await queued<{ orgId: string; evidenceId: string }>(
      su,
      "evidence",
      orgId,
    )
    expect(jobs.map((job) => job.data.evidenceId)).toContain(id)
    const again = await upload(id, { cookie: owner.cookie, body: png })
    expect(again.status).toBe(200)
    expect(await again.json()).toEqual({ status: "received" })
    const after = await queued<{ orgId: string; evidenceId: string }>(
      su,
      "evidence",
      orgId,
    )
    expect(after.filter((job) => job.data.evidenceId === id)).toHaveLength(1)
  })

  test("[AC-UPLOAD-02] Given a file awaiting upload, when nobody, another account or another campus sends it, then the server answers 401 or 404 and stores nothing", async () => {
    const owner = await signedIn(HOST, person("pemilik"))
    const stranger = await signedIn(HOST, person("orang"))
    const id = await submitted(owner, {
      name: "bukti.png",
      size: png.length,
      type: "image/png",
    })
    const anon = await upload(id, { body: png })
    expect(anon.status).toBe(401)
    const foreign = await upload(id, { cookie: stranger.cookie, body: png })
    expect(foreign.status).toBe(404)
    const elsewhere = await signedIn(OTHER, person("kampuslain"))
    const otherHost = await upload(id, {
      cookie: elsewhere.cookie,
      body: png,
      host: OTHER,
    })
    expect(otherHost.status).toBe(404)
    expect((await row(id))?.status).toBe("awaiting_upload")
  })

  test("[AC-UPLOAD-03] Given a file declared as a PDF, when image bytes are sent, then the server answers 415 because the type comes from the bytes", async () => {
    const owner = await signedIn(HOST, person("jenis"))
    const id = await submitted(owner, {
      name: "dokumen.pdf",
      size: png.length,
      type: "application/pdf",
    })
    const res = await upload(id, { cookie: owner.cookie, body: png })
    expect(res.status).toBe(415)
    expect(await res.json()).toEqual({ error: "unsupported_type" })
    expect((await row(id))?.status).toBe("awaiting_upload")
  })

  test("[AC-UPLOAD-04] Given a declared file size, when more bytes are sent, then the server answers 413 and stores nothing", async () => {
    const owner = await signedIn(HOST, person("besar"))
    const id = await submitted(owner, {
      name: "bukti.png",
      size: png.length - 10,
      type: "image/png",
    })
    const res = await upload(id, { cookie: owner.cookie, body: png })
    expect(res.status).toBe(413)
    expect(await res.json()).toEqual({ error: "too_large" })
    expect((await row(id))?.status).toBe("awaiting_upload")
  })

  test("[AC-UPLOAD-05] Given a report sent more than 24 hours ago, when its missing file is sent, then the server answers 410 and the window stays closed", async () => {
    const owner = await signedIn(HOST, person("telat"))
    const id = await submitted(owner, {
      name: "bukti.png",
      size: png.length,
      type: "image/png",
    })
    await su.query(
      `UPDATE reports SET created_at = now() - interval '25 hours'
       WHERE id = (SELECT report_id FROM evidence WHERE id = $1)`,
      [id],
    )
    const res = await upload(id, { cookie: owner.cookie, body: png })
    expect(res.status).toBe(410)
    expect(await res.json()).toEqual({ error: "upload_window_closed" })
    const head = await upload(id, {
      method: "HEAD",
      cookie: owner.cookie,
      headers: tus(),
    })
    expect(head.status).toBe(410)
  })

  test("[AC-UPLOAD-06] Given an upload cut off mid-file, when the owner asks for the offset and sends the rest, then the stored bytes are kept and the file completes", async () => {
    const owner = await signedIn(HOST, person("lanjut"))
    const id = await submitted(owner, {
      name: "bukti.png",
      size: png.length,
      type: "image/png",
    })
    const start = await upload(id, {
      method: "HEAD",
      cookie: owner.cookie,
      headers: tus(),
    })
    expect(start.status).toBe(200)
    expect(start.headers.get("Upload-Offset")).toBe("0")
    expect(start.headers.get("Upload-Length")).toBe(String(png.length))
    expect(start.headers.get("Cache-Control")).toBe("private, no-store")
    const half = Math.floor(png.length / 2)
    const first = await upload(id, {
      method: "PATCH",
      cookie: owner.cookie,
      body: png.subarray(0, half),
      headers: tus({
        "Content-Type": "application/offset+octet-stream",
        "Upload-Offset": "0",
      }),
    })
    expect(first.status).toBe(204)
    expect(first.headers.get("Upload-Offset")).toBe(String(half))
    expect((await row(id))?.status).toBe("awaiting_upload")
    const resumed = await upload(id, {
      method: "HEAD",
      cookie: owner.cookie,
      headers: tus(),
    })
    expect(resumed.headers.get("Upload-Offset")).toBe(String(half))
    // Override tunnels PATCH through POST
    const rest = await upload(id, {
      method: "POST",
      cookie: owner.cookie,
      body: png.subarray(half),
      headers: tus({
        "X-HTTP-Method-Override": "PATCH",
        "Content-Type": "application/offset+octet-stream",
        "Upload-Offset": String(half),
      }),
    })
    expect(rest.status).toBe(204)
    expect(rest.headers.get("Upload-Offset")).toBe(String(png.length))
    expect(await row(id)).toEqual({
      status: "received",
      detected_type: "image/png",
      byte_size: String(png.length),
    })
    const stored = await Bun.file(
      originalPath(defaultFilesDir(), orgId, id),
    ).bytes()
    expect(Buffer.from(stored).equals(Buffer.from(png))).toBe(true)
  })

  test("[AC-UPLOAD-07] Given a resumable upload, when the client breaks the protocol, then each mistake gets its tus status and nothing is appended", async () => {
    const owner = await signedIn(HOST, person("tus"))
    const id = await submitted(owner, {
      name: "bukti.png",
      size: png.length,
      type: "image/png",
    })
    const patch = (headers: Record<string, string>) =>
      upload(id, {
        method: "PATCH",
        cookie: owner.cookie,
        body: png.subarray(0, 100),
        headers,
      })
    const octets = { "Content-Type": "application/offset+octet-stream" }
    expect((await patch({ ...octets, "Upload-Offset": "0" })).status).toBe(412)
    const badOffset = await patch(tus({ ...octets, "Upload-Offset": "abc" }))
    expect(badOffset.status).toBe(400)
    expect(await badOffset.json()).toEqual({ error: "bad_offset" })
    const mismatch = await patch(tus({ ...octets, "Upload-Offset": "50" }))
    expect(mismatch.status).toBe(409)
    expect(await mismatch.json()).toEqual({ error: "offset_mismatch" })
    const wrongType = await patch(
      tus({ "Content-Type": "image/png", "Upload-Offset": "0" }),
    )
    expect(wrongType.status).toBe(415)
    const options = await upload(id, {
      method: "OPTIONS",
      cookie: owner.cookie,
    })
    expect(options.status).toBe(204)
    expect(options.headers.get("Tus-Version")).toBe("1.0.0")
    expect(options.headers.get("Tus-Max-Size")).toBe("52428800")
    const head = await upload(id, {
      method: "HEAD",
      cookie: owner.cookie,
      headers: tus(),
    })
    expect(head.headers.get("Upload-Offset")).toBe("0")
  })

  test("[AC-UPLOAD-08] Given a signed-in owner, when a PATCH arrives from another site's origin, then the server refuses it with 403 before touching the file", async () => {
    const owner = await signedIn(HOST, person("asal"))
    const id = await submitted(owner, {
      name: "bukti.png",
      size: png.length,
      type: "image/png",
    })
    const res = await upload(id, {
      method: "PATCH",
      cookie: owner.cookie,
      body: png.subarray(0, 100),
      headers: tus({
        origin: "https://jahat.example",
        "Content-Type": "application/offset+octet-stream",
        "Upload-Offset": "0",
      }),
    })
    expect(res.status).toBe(403)
    const head = await upload(id, {
      method: "HEAD",
      cookie: owner.cookie,
      headers: tus(),
    })
    expect(head.headers.get("Upload-Offset")).toBe("0")
  })

  test("[AC-UPLOAD-09] Given a campus that paused intake, when a file is sent, then the server answers 503 intake_paused", async () => {
    const owner = await signedIn(HOST, person("jeda"))
    const id = await submitted(owner, {
      name: "bukti.png",
      size: png.length,
      type: "image/png",
    })
    await su.query(
      `UPDATE organizations SET settings = settings || '{"intakePaused": true}' WHERE id = $1`,
      [orgId],
    )
    hostsChanged([HOST])
    try {
      const res = await upload(id, { cookie: owner.cookie, body: png })
      expect(res.status).toBe(503)
      expect(await res.json()).toEqual({ error: "intake_paused" })
    } finally {
      await su.query(
        "UPDATE organizations SET settings = settings - 'intakePaused' WHERE id = $1",
        [orgId],
      )
      hostsChanged([HOST])
    }
  })

  test("[AC-UPLOAD-10] Given a report that was forwarded to another campus, when its file is resumed, then the server answers 403 report_closed", async () => {
    const owner = await signedIn(HOST, person("tutup"))
    const id = await submitted(owner, {
      name: "bukti.png",
      size: png.length,
      type: "image/png",
    })
    await su.query(
      `UPDATE reports SET status = 'forwarded'
       WHERE id = (SELECT report_id FROM evidence WHERE id = $1)`,
      [id],
    )
    const res = await upload(id, {
      method: "PATCH",
      cookie: owner.cookie,
      body: png.subarray(0, 100),
      headers: tus({
        "Content-Type": "application/offset+octet-stream",
        "Upload-Offset": "0",
      }),
    })
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: "report_closed" })
  })
})
