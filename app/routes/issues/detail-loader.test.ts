import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { drizzle } from "drizzle-orm/node-postgres"
import { RouterContextProvider } from "react-router"
import { migrate } from "../../../db/migrate.ts"
import { issues } from "../../../db/schema/issues.ts"
import { reports } from "../../../db/schema/reports.ts"
import {
  insertOrg,
  insertRegions,
  insertUser,
  reportValues,
  resetData,
  superuserPool,
  testUrl,
} from "../../../db/testing.ts"
import { jakartaIsoDate } from "../../../shared/format.ts"
import { sessionContext, tenantContext } from "../../context.ts"
import { loader } from "./detail"

const su = superuserPool()
const suDb = drizzle({ client: su })
const HOST = "dtl.localhost"
const CODE = "ISU-2026-10-0001"
const IMAGE = `${"a".repeat(64)}.webp`
const POSTER = `${"b".repeat(64)}.webp`
const VIDEO = `${"c".repeat(64)}.mp4`
const savedOrigin = process.env.MEDIA_PUBLIC_ORIGIN
let orgId = ""

function args(): never {
  const provider = new RouterContextProvider()
  provider.set(tenantContext, {
    id: orgId,
    slug: "dtl",
    host: HOST,
    name: "KM DTL",
    campusCode: "DTL",
    campusName: "Kampus DTL",
    theme: {},
    settings: {},
  })
  provider.set(sessionContext, null)
  return { params: { code: CODE }, context: provider } as never
}

beforeAll(async () => {
  await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
  await resetData(su)
  await insertRegions(su)
  orgId = await insertOrg(su, "dtl")
  const user = await insertUser(su, "pelapor.detail@contoh.id")
  const [issue] = await suDb
    .insert(issues)
    .values({
      orgId,
      year: 2026,
      number: 1,
      publicCode: CODE,
      title: "Jembatan retak di Coblong",
      summary: "Warga melaporkan retakan besar pada jembatan.",
      categoryId: "program",
      subcategoryId: "program.infrastruktur",
      provinceCode: "32",
      regencyCode: "32.73",
      reportCount: 1,
      govStatus: "awaiting_response",
      publishedAt: new Date("2026-10-01T03:00:00Z"),
    })
    .returning({ id: issues.id })
  const [report] = await suDb
    .insert(reports)
    .values(reportValues(orgId, user, { status: "merged" }))
    .returning({ id: reports.id })
  await su.query(
    "INSERT INTO issue_reports (org_id, issue_id, report_id) VALUES ($1, $2, $3)",
    [orgId, issue?.id, report?.id],
  )
  const media = {
    image: [{ type: "image", file: IMAGE, page: 0, width: 4, height: 3 }],
    video: [
      {
        type: "video",
        file: VIDEO,
        poster: POSTER,
        store: "r2",
        width: 16,
        height: 9,
      },
    ],
  }
  for (const [position, kind] of [
    [0, "image"],
    [1, "video"],
  ] as const) {
    await su.query(
      `INSERT INTO evidence (org_id, report_id, position, kind, declared_name,
         declared_type, declared_size, status, decision, decided_at,
         public_media, published_at)
       VALUES ($1, $2, $3, $4, 'f', 'image/jpeg', 1, 'published', 'no_redaction',
         now(), $5, now())`,
      [orgId, report?.id, position, kind, JSON.stringify(media[kind])],
    )
  }
  // Newer first, so order matters
  await su.query(
    `INSERT INTO referrals (org_id, issue_id, kind, agency, channel, sent_on, deadline_on)
     VALUES ($1, $2, 'referral', 'Dinas PU Kota Bandung', 'official_letter',
       '2026-10-02', '2026-10-16'),
       ($1, $2, 'referral', 'Dinas Lama', 'official_letter', '2026-09-20', '2026-10-04')`,
    [orgId, issue?.id],
  )
})

afterAll(async () => {
  if (savedOrigin === undefined) delete process.env.MEDIA_PUBLIC_ORIGIN
  else process.env.MEDIA_PUBLIC_ORIGIN = savedOrigin
  await resetData(su)
  await su.end()
})

describe("issue page loader, /isu/:code", () => {
  test("Given a referred issue, when its page loads, then the latest referral and no escalation are shown", async () => {
    const page = await loader(args())
    expect(page.referral).toMatchObject({
      kind: "referral",
      agency: "Dinas PU Kota Bandung",
      channel: "official_letter",
      sentOn: "2026-10-02",
      deadlineOn: "2026-10-16",
    })
    expect(page.escalation).toBeNull()
    const today = Date.parse(jakartaIsoDate(new Date()))
    expect(page.wait).toEqual({
      days: Math.round((today - Date.parse("2026-10-02")) / 86_400_000),
      overdue: true,
    })
  })

  test("Given published copies, when no media origin is set, then images show from /media and a stored-off video is left out", async () => {
    delete process.env.MEDIA_PUBLIC_ORIGIN
    const page = await loader(args())
    expect(page.evidence).toHaveLength(1)
    expect(page.evidence[0]).toMatchObject({
      kind: "image",
      redacted: false,
      media: [
        { type: "image", src: `/media/${IMAGE}`, page: 0, width: 4, height: 3 },
      ],
    })
  })

  test("with a media origin the video plays from it, poster from /media", async () => {
    process.env.MEDIA_PUBLIC_ORIGIN = "https://media.contoh.id"
    const page = await loader(args())
    expect(page.evidence[1]?.media).toEqual([
      {
        type: "video",
        src: `https://media.contoh.id/${HOST}/${VIDEO}`,
        poster: `/media/${POSTER}`,
        width: 16,
        height: 9,
      },
    ])
  })
})
