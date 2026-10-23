import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import sharp from "sharp"
import { migrate } from "../../../db/migrate.ts"
import {
  insertOrg,
  insertRegions,
  insertUser,
  resetData,
  superuserPool,
  testUrl,
} from "../../../db/testing.ts"
import { createUploadHandler } from "../../../server/api/upload.server.ts"
import type { TurnstileResult } from "../../../server/turnstile.server.ts"
import { CONSENT_TEXT_VERSION } from "../../../shared/report-fields.ts"
import type { SessionContext, TenantContext } from "../../context.ts"
import { handleSubmit, type SubmitDeps } from "./submit.server.ts"

const su = superuserPool()
let orgA = ""
let orgB = ""
let userA = ""
let filesDir = ""
let png = new Uint8Array(new ArrayBuffer(0))
let captchaCalls = 0

function tenant(id: string, code: string): TenantContext {
  return {
    id,
    slug: code.toLowerCase(),
    host: `${code.toLowerCase()}.localhost`,
    name: code,
    campusCode: code,
    campusName: code,
    theme: {},
    settings: {},
  }
}

const ACCOUNT_PHONE = "+6281234567890"

function session(
  userId: string,
  phoneNumber: string | null = ACCOUNT_PHONE,
  phoneVerified = true,
): SessionContext {
  const at = new Date()
  return {
    user: {
      id: userId,
      email: "pelapor@contoh.id",
      emailVerified: true,
      name: "",
      phoneNumber,
      phoneVerified,
      twoFactorEnabled: false,
      updatedAt: at,
    },
    session: { id: "s", createdAt: at, expiresAt: at },
  }
}

function body(overrides: Record<string, unknown> = {}) {
  return {
    submissionId: crypto.randomUUID(),
    turnstileToken: "XXXX.DUMMY.TOKEN.XXXX",
    relation: { relation: "self" },
    location: {
      provinceCode: "32",
      regencyCode: "32.73",
      districtCode: "32.73.02",
    },
    details: {
      title: "Atap sekolah runtuh",
      story:
        "Atap ruang kelas runtuh minggu lalu dan siswa belajar di halaman sekolah.",
      categoryId: "program",
      subcategoryId: "program.pendidikan",
      occurredOn: "2026-10-01",
      urgency: "medium",
    },
    impact: {
      groups: ["students"],
      affectedCount: "11_100",
      ongoing: "yes",
    },
    evidence: [
      { name: "atap.png", size: 2000, type: "image/png" },
      { name: "kelas.png", size: 2000, type: "image/png" },
    ],
    contact: { contactable: "yes", method: "phone" },
    consent: {
      consents: {
        age_18_plus: true,
        accurate: true,
        public_issue: true,
        aggregate_processing: true,
      },
      consentTextVersion: CONSENT_TEXT_VERSION,
    },
    ...overrides,
  }
}

function deps(overrides: Partial<SubmitDeps> = {}): SubmitDeps {
  return {
    now: () => new Date("2026-10-13T03:00:00Z"),
    intakePaused: false,
    verifyCaptcha: async (): Promise<TurnstileResult> => {
      captchaCalls++
      return { ok: true }
    },
    ...overrides,
  }
}

function submit(
  input: unknown,
  opts: {
    org?: TenantContext
    user?: string | null
    phone?: string | null
    phoneVerified?: boolean
    deps?: SubmitDeps
  } = {},
) {
  return handleSubmit({
    body: input,
    tenant: opts.org ?? tenant(orgA, "ITB"),
    session:
      opts.user === null
        ? null
        : session(
            opts.user ?? userA,
            opts.phone === undefined ? ACCOUNT_PHONE : opts.phone,
            opts.phoneVerified,
          ),
    remoteIp: null,
    deps: opts.deps ?? deps(),
  })
}

async function count(table: string, column = "org_id", value = orgA) {
  const { rows } = await su.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM ${table} WHERE ${column} = $1`,
    [value],
  )
  return rows[0]?.n ?? 0
}

beforeAll(async () => {
  await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
  await resetData(su)
  await insertRegions(su)
  orgA = await insertOrg(su, "itb")
  orgB = await insertOrg(su, "ugm")
  userA = await insertUser(su, "pelapor.submit@contoh.id")
  filesDir = await mkdtemp(join(tmpdir(), "sm-submit-"))
  png = new Uint8Array(
    await sharp({
      create: { width: 4, height: 4, channels: 3, background: "#0f55d6" },
    })
      .png()
      .toBuffer(),
  )
})

beforeEach(async () => {
  captchaCalls = 0
  await su.query("DELETE FROM reports WHERE org_id IN ($1, $2)", [orgA, orgB])
  await su.query("DELETE FROM members WHERE user_id = $1", [userA])
})

afterAll(async () => {
  await rm(filesDir, { recursive: true, force: true })
  await resetData(su)
  await su.end()
})

describe("submit", () => {
  test("creates the report, contact, evidence rows and reporter role", async () => {
    const result = await submit(body())
    expect(result.status).toBe(201)
    if (!("code" in result.body)) throw new Error("no code")
    expect(result.body.code).toBe("LPR-2026-10-0001")
    expect(result.body.evidence.map((e) => e.position)).toEqual([0, 1])
    expect(await count("reports")).toBe(1)
    expect(await count("report_contacts")).toBe(1)
    const { rows } = await su.query<{ status: string }>(
      "SELECT status FROM evidence WHERE org_id = $1",
      [orgA],
    )
    expect(rows.map((r) => r.status)).toEqual([
      "awaiting_upload",
      "awaiting_upload",
    ])
    const role = await su.query<{ role: string }>(
      "SELECT role FROM members WHERE organization_id = $1 AND user_id = $2",
      [orgA, userA],
    )
    expect(role.rows[0]?.role).toBe("reporter")
    expect(await count("audit_log")).toBeGreaterThanOrEqual(1)
  })

  test("stores the consent record with server time and version", async () => {
    await submit(body())
    const { rows } = await su.query<{
      consents: string[]
      consent_text_version: string
      consented_at: Date | null
    }>(
      "SELECT consents, consent_text_version, consented_at FROM reports WHERE org_id = $1",
      [orgA],
    )
    expect(rows[0]?.consents).toEqual([
      "age_18_plus",
      "accurate",
      "public_issue",
      "aggregate_processing",
    ])
    expect(rows[0]?.consent_text_version).toBe(CONSENT_TEXT_VERSION)
    expect(rows[0]?.consented_at).toBeInstanceOf(Date)
  })

  test("the contact number is the account's number", async () => {
    await submit(
      body({
        contact: { contactable: "yes", method: "whatsapp", phone: "0899" },
      }),
    )
    const { rows } = await su.query<{ phone: string; method: string }>(
      "SELECT phone, method FROM report_contacts WHERE org_id = $1",
      [orgA],
    )
    expect(rows).toEqual([{ phone: ACCOUNT_PHONE, method: "whatsapp" }])
  })

  test("contact yes without a number on the account is refused", async () => {
    const result = await submit(body(), { phone: null })
    expect(result).toEqual({
      status: 400,
      body: {
        errors: [
          { path: "contact.contactable", key: "error_contact_no_phone" },
        ],
      },
    })
    expect(await count("reports")).toBe(0)
    const ok = await submit(body({ contact: { contactable: "no" } }), {
      phone: null,
    })
    expect(ok.status).toBe(201)
  })

  test("an unproven number is never the contact", async () => {
    const result = await submit(body(), { phoneVerified: false })
    expect(result).toEqual({
      status: 400,
      body: {
        errors: [
          {
            path: "contact.contactable",
            key: "error_contact_phone_unverified",
          },
        ],
      },
    })
    expect(await count("reports")).toBe(0)
    expect(await count("report_contacts")).toBe(0)
  })

  test("a contact of no stores no contact row", async () => {
    await submit(body({ contact: { contactable: "no" } }))
    expect(await count("reports")).toBe(1)
    expect(await count("report_contacts")).toBe(0)
  })
})

describe("idempotency", () => {
  test("two concurrent submits with one key give one report", async () => {
    const input = body()
    const [a, b] = await Promise.all([submit(input), submit(input)])
    expect([a.status, b.status].sort()).toEqual([200, 201])
    expect(a.body).toEqual(b.body)
    expect(await count("reports")).toBe(1)
    expect(await count("report_contacts")).toBe(1)
    expect(await count("evidence")).toBe(2)
    // One receipt per report
    expect(await count("notifications")).toBe(1)
    const { rows } = await su.query<{ template: string }>(
      "SELECT template FROM notifications WHERE org_id = $1",
      [orgA],
    )
    expect(rows).toEqual([{ template: "report_submitted" }])
  })

  test("a retry returns the report before checking Turnstile", async () => {
    const input = body()
    const first = await submit(input)
    captchaCalls = 0
    const again = await submit({ ...input, turnstileToken: "" })
    expect(again.status).toBe(200)
    expect(again.body).toEqual(first.body)
    expect(captchaCalls).toBe(0)
  })

  test("a duplicate token answer looks the report up again", async () => {
    const input = body()
    const first = await submit(input)
    const again = await handleSubmit({
      body: input,
      tenant: tenant(orgA, "ITB"),
      session: session(userA),
      remoteIp: null,
      deps: deps({
        verifyCaptcha: async () => ({ ok: false, reason: "duplicate" }),
      }),
    })
    expect(again.body).toEqual(first.body)
  })
})

describe("refusals", () => {
  test("without the 18+ box nothing is stored", async () => {
    const input = body()
    input.consent.consents.age_18_plus = false
    const result = await submit(input)
    expect(result.status).toBe(400)
    expect(result.body).toEqual({
      errors: [
        {
          path: "consent.consents.age_18_plus",
          key: "error_consent_age_required",
        },
      ],
    })
    expect(captchaCalls).toBe(0)
    expect(await count("reports")).toBe(0)
  })

  test("an outdated consent text version is refused", async () => {
    const input = body()
    input.consent.consentTextVersion = "2020-01-01"
    const result = await submit(input)
    expect(result.status).toBe(400)
    expect(await count("reports")).toBe(0)
  })

  test("no session is 401", async () => {
    expect((await submit(body(), { user: null })).status).toBe(401)
  })

  test("intake pause is 503", async () => {
    const result = await submit(body(), { deps: deps({ intakePaused: true }) })
    expect(result.status).toBe(503)
    const paused = await submit(body(), {
      org: { ...tenant(orgA, "ITB"), settings: { intakePaused: true } },
    })
    expect(paused.status).toBe(503)
    expect(await count("reports")).toBe(0)
  })

  test("a failed Turnstile check stores nothing", async () => {
    const result = await submit(body(), {
      deps: deps({
        verifyCaptcha: async () => ({ ok: false, reason: "rejected" }),
      }),
    })
    expect(result.status).toBe(403)
    expect(await count("reports")).toBe(0)
  })

  test("the device point is stored, and only when sent", async () => {
    const location = {
      provinceCode: "32",
      regencyCode: "32.73",
      districtCode: "32.73.02",
    }
    const withPoint = await submit(
      body({ location: { ...location, point: { lat: -6.89, lng: 107.61 } } }),
    )
    const without = await submit(body({ location }))
    expect([withPoint.status, without.status]).toEqual([201, 201])
    const { rows } = await su.query<{ point: string | null }>(
      "SELECT ST_AsText(point) AS point FROM reports WHERE org_id = $1 ORDER BY created_at",
      [orgA],
    )
    expect(rows.map((r) => r.point)).toEqual(["POINT(107.61 -6.89)", null])
  })

  test("a region code that does not exist is a field error", async () => {
    const result = await submit(
      body({
        location: {
          provinceCode: "32",
          regencyCode: "32.73",
          districtCode: "32.73.09",
        },
      }),
    )
    expect(result.status).toBe(400)
    expect(result.body).toEqual({
      errors: [
        { path: "location.districtCode", key: "error_district_required" },
      ],
    })
  })

  test("PDF, HEIC and video evidence are accepted", async () => {
    const result = await submit(
      body({
        evidence: [
          { name: "surat.pdf", size: 2000, type: "application/pdf" },
          { name: "IMG_0001.HEIC", size: 3000, type: "" },
          {
            name: "rekaman.mov",
            size: 4000,
            type: "video/quicktime",
            durationSeconds: 30,
            width: 1920,
            height: 1080,
          },
        ],
      }),
    )
    expect(result.status).toBe(201)
    const { rows } = await su.query<{ kind: string }>(
      "SELECT kind FROM evidence ORDER BY position",
    )
    expect(rows.map((r) => r.kind)).toEqual(["pdf", "image", "video"])
  })

  test("a video over 3 minutes is refused", async () => {
    const result = await submit(
      body({
        evidence: [
          {
            name: "panjang.mp4",
            size: 4000,
            type: "video/mp4",
            durationSeconds: 200,
          },
        ],
      }),
    )
    expect(result.status).toBe(400)
    expect(await count("reports")).toBe(0)
  })

  test("the sixth report in 24 hours is refused", async () => {
    for (let i = 0; i < 5; i++) {
      expect((await submit(body())).status).toBe(201)
    }
    const sixth = await submit(body())
    expect(sixth.status).toBe(429)
    expect(await count("reports")).toBe(5)
  })
})

describe("upload after submit", () => {
  test("another tenant cannot upload to the new evidence id", async () => {
    const result = await submit(
      body({
        evidence: [{ name: "a.png", size: png.byteLength, type: "image/png" }],
      }),
    )
    if (!("evidence" in result.body)) throw new Error("no evidence")
    const evidenceId = result.body.evidence[0]?.id ?? ""
    const receive = createUploadHandler({
      filesDir,
      now: () => new Date(),
      maxConcurrent: 4,
      maxPerIp: 3,
      intakePaused: false,
      tenantDailyBytes: 10 * 1024 ** 3,
    })
    const upload = (org: TenantContext) =>
      receive({
        request: new Request(`http://x.localhost/api/upload/${evidenceId}`, {
          method: "POST",
          body: png,
        }),
        evidenceId,
        tenant: org,
        session: session(userA),
      })
    expect((await upload(tenant(orgB, "UGM"))).status).toBe(404)
    const { rows } = await su.query<{ status: string }>(
      "SELECT status FROM evidence WHERE id = $1",
      [evidenceId],
    )
    expect(rows[0]?.status).toBe("awaiting_upload")
    expect((await upload(tenant(orgA, "ITB"))).status).toBe(201)
  })
})
