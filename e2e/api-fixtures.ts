// Bun: reporter, upload row, codes
// bun --env-file=.env e2e/api-fixtures.ts <host> <png>
import { and, eq, isNotNull, isNull } from "drizzle-orm"
import sharp from "sharp"
import { handleSubmit } from "../app/features/report/submit.server.ts"
import { database } from "../db/client.server.ts"
import { users } from "../db/schema/auth.ts"
import { demands } from "../db/schema/demands.ts"
import { issues } from "../db/schema/issues.ts"
import { getTenantByHost, withTenant } from "../db/tenant.server.ts"
import { CONSENT_TEXT_VERSION } from "../shared/report-fields.ts"
import { accountClient, jar } from "./sign-in.ts"

const host = process.argv[2] ?? "itb.localhost"
const pngPath = process.argv[3]
if (!pngPath) throw new Error("png path missing")
const tenant = await getTenantByHost(host)
if (!tenant) throw new Error(`no campus at ${host}`)

// Fresh reporter, fresh daily quota
const stamp = Date.now()
const reporter = {
  email: `e2e-pelapor-${stamp}@contoh.test`,
  phone: `+62813${String(stamp % 100_000_000).padStart(8, "0")}`,
  name: "Pelapor Uji",
}
const { signIn } = accountClient(host)
const cookie = jar(await signIn(reporter))
const [user] = await database()
  .db.select()
  .from(users)
  .where(eq(users.email, reporter.email))
if (!user) throw new Error("reporter not created")

// Real PNG, noise beats compression
let seed = 1
const raw = Buffer.alloc(320 * 240 * 3)
for (let i = 0; i < raw.length; i++) {
  seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31
  raw[i] = seed >> 23
}
const png = await sharp(raw, { raw: { width: 320, height: 240, channels: 3 } })
  .png()
  .toBuffer()
await Bun.write(pngPath, png)

// Step-7 submit, captcha stubbed
const submitted = await handleSubmit({
  body: {
    submissionId: crypto.randomUUID(),
    relation: { relation: "self" },
    location: {
      provinceCode: "32",
      regencyCode: "32.73",
      districtCode: "32.73.01",
      villageCode: "32.73.01.1001",
    },
    details: {
      title: "Uji unggahan yang bisa dilanjutkan",
      story: "Laporan uji otomatis untuk unggahan bukti yang terputus.",
      categoryId: "program",
      subcategoryId: "program.infrastruktur",
      occurredOn: new Date(stamp - 86_400_000).toISOString().slice(0, 10),
      urgency: "medium",
    },
    impact: {
      groups: ["general_public"],
      affectedCount: "101_1000",
      ongoing: "yes",
    },
    evidence: [{ name: "bukti.png", size: png.length, type: "image/png" }],
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
  },
  tenant,
  session: {
    user,
    session: {
      id: "fixture",
      createdAt: new Date(stamp),
      expiresAt: new Date(stamp + 3_600_000),
    },
  },
  remoteIp: null,
  deps: {
    now: () => new Date(),
    intakePaused: false,
    verifyCaptcha: async () => ({ ok: true }),
  },
})
if (submitted.status !== 201) {
  throw new Error(`submit ${submitted.status} ${JSON.stringify(submitted)}`)
}
const evidenceId = submitted.body.evidence[0]?.id
if (!evidenceId) throw new Error("no evidence row")

// Codes the public never sees
const codes = await withTenant(
  tenant.id,
  async (tx) => {
    const [unpublished] = await tx
      .select({ code: issues.publicCode })
      .from(issues)
      .where(and(isNull(issues.publishedAt), isNull(issues.takenDownAt)))
      .limit(1)
    const [takenDown] = await tx
      .select({ code: issues.publicCode })
      .from(issues)
      .where(isNotNull(issues.takenDownAt))
      .limit(1)
    const [draft] = await tx
      .select({ code: demands.publicCode })
      .from(demands)
      .where(eq(demands.state, "draft"))
      .limit(1)
    return {
      unpublishedIssue: unpublished?.code ?? null,
      takenDownIssue: takenDown?.code ?? null,
      draftDemand: draft?.code ?? null,
    }
  },
  { role: "admin" },
)

console.log(JSON.stringify({ cookie, evidenceId, size: png.length, ...codes }))
await database().pool.end()
