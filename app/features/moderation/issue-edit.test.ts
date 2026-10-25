import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { drizzle } from "drizzle-orm/node-postgres"
import { migrate } from "../../../db/migrate.ts"
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
import type { PurgeClient } from "../../../server/purge.server.ts"
import { runPublish } from "../issues/publish.server.ts"
import { editIssue, parseEditForm } from "./issue-edit.server.ts"
import { runMerge } from "./merge.server.ts"

process.env.AUDIT_HMAC_KEY ||= Buffer.alloc(32, 7).toString("base64")

const su = superuserPool()
const suDb = drizzle({ client: su })
const NOW = new Date("2026-10-13T03:00:00Z")
const TITLE = "Atap sekolah runtuh di Coblong"
let org = ""
let other = ""
let moderator = ""
let purged: string[][] = []
const purge: PurgeClient = {
  purgeUrls: async (urls) => {
    purged.push(urls)
    return { skipped: false }
  },
  purgeHosts: async () => ({ skipped: false }),
}
const tenant = () => ({ id: org, host: "edt.localhost" })

async function issue() {
  const reporter = await insertUser(su, `p${crypto.randomUUID()}@contoh.id`)
  const [report] = await suDb
    .insert(reports)
    .values(
      reportValues(org, reporter, {
        status: "verified",
        verifiedAt: NOW,
      }),
    )
    .returning({ id: reports.id })
  if (!report) throw new Error("no report")
  const merged = await runMerge(org, {
    reportIds: [report.id],
    target: {
      kind: "new",
      title: TITLE,
      summary: "Warga melaporkan atap kelas runtuh sejak sebulan lalu.",
    },
    actorId: moderator,
    campusCode: "EDT",
    now: NOW,
    notify: false,
  })
  if (!merged.ok) throw new Error(merged.reason)
  return merged
}

function form(values: Record<string, string>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(values)) data.set(key, value)
  return data
}

const VALID = {
  title: "Atap ruang kelas SD runtuh",
  summary: "Atap ruang kelas sebuah SD runtuh dan siswa belajar di halaman.",
  subcategoryId: "program.pendidikan",
  regencyCode: "34.71",
  version: "1",
}

beforeAll(async () => {
  await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
  await resetData(su)
  await insertRegions(su)
  await su.query(
    `INSERT INTO regions (code, parent_code, level, name) VALUES
       ('34', NULL, 1, 'Daerah Istimewa Yogyakarta'),
       ('34.71', '34', 2, 'Kota Yogyakarta') ON CONFLICT DO NOTHING`,
  )
  org = await insertOrg(su, "edt")
  other = await insertOrg(su, "edu")
  moderator = await insertUser(su, "mod.edit@contoh.id")
  for (const id of [org, other]) {
    await su.query(
      "INSERT INTO members (organization_id, user_id, role) VALUES ($1, $2, 'admin')",
      [id, moderator],
    )
  }
})

afterAll(async () => {
  await resetData(su)
  await su.end()
})

describe("parseEditForm", () => {
  test("valid input, province from regency", async () => {
    expect(await parseEditForm(form(VALID))).toEqual({
      ok: true,
      value: {
        title: VALID.title,
        summary: VALID.summary,
        categoryId: "program",
        subcategoryId: "program.pendidikan",
        provinceCode: "34",
        regencyCode: "34.71",
        version: 1,
      },
    })
  })

  test("short text, unknown place and category refused", async () => {
    expect(
      await parseEditForm(
        form({
          ...VALID,
          title: "Atap",
          summary: "Pendek",
          subcategoryId: "program.tidak_ada",
          regencyCode: "32",
        }),
      ),
    ).toEqual({
      ok: false,
      errors: [
        "edit_title",
        "edit_summary",
        "edit_subcategory",
        "edit_regency",
      ],
    })
  })
})

describe("editIssue, PLAN §5.10 pre-publish fixes", () => {
  test("changes text and place, version bumped, audited", async () => {
    const merged = await issue()
    const parsed = await parseEditForm(form(VALID))
    if (!parsed?.ok) throw new Error("parse")
    expect(
      await editIssue(
        tenant(),
        { ...parsed.value, issueId: merged.issueId, actorId: moderator },
        { purge },
      ),
    ).toEqual({ ok: true })
    const { rows } = await su.query(
      `SELECT title, category_id, subcategory_id, province_code, regency_code,
         district_code, version FROM issues WHERE id = $1`,
      [merged.issueId],
    )
    expect(rows[0]).toEqual({
      title: VALID.title,
      category_id: "program",
      subcategory_id: "program.pendidikan",
      province_code: "34",
      regency_code: "34.71",
      district_code: null,
      version: 2,
    })
    const { rows: audit } = await su.query(
      "SELECT changed_columns, value_hashes FROM audit_log WHERE action = 'issue.edit' AND entity_id = $1",
      [merged.issueId],
    )
    expect(audit[0]?.changed_columns).toEqual([
      "title",
      "summary",
      "province_code",
      "regency_code",
    ])
    // Hashes only, never text
    expect(JSON.stringify(audit[0]?.value_hashes)).not.toContain("Atap")
    // Unpublished, nothing cached
    expect(purged).toEqual([])
  })

  test("a published edit purges its pages", async () => {
    const merged = await issue()
    await runPublish(
      tenant(),
      { issueId: merged.issueId, actorId: moderator, notify: false },
      { purge },
    )
    purged = []
    expect(
      await editIssue(
        tenant(),
        {
          ...VALID,
          subcategoryId: "program.pendidikan",
          categoryId: "program",
          provinceCode: "34",
          version: 2,
          issueId: merged.issueId,
          actorId: moderator,
        },
        { purge },
      ),
    ).toEqual({ ok: true })
    // Old title leaves the edge
    expect(purged.flat()).toContain(
      `https://edt.localhost/isu/${merged.code}/og.png?v=2`,
    )
    expect(purged.flat()).toContain("https://edt.localhost/data")
  })

  test("stale version, no change and other campus refused", async () => {
    const merged = await issue()
    const base = {
      title: TITLE,
      summary: "Warga melaporkan atap kelas runtuh sejak sebulan lalu.",
      categoryId: "program" as const,
      subcategoryId: "program.pendidikan" as const,
      provinceCode: "32",
      regencyCode: "32.73",
      issueId: merged.issueId,
      actorId: moderator,
    }
    expect(
      await editIssue(tenant(), { ...base, version: 9 }, { purge }),
    ).toEqual({ ok: false, reason: "changed" })
    expect(
      await editIssue(tenant(), { ...base, version: 1 }, { purge }),
    ).toEqual({ ok: false, reason: "unchanged" })
    expect(
      await editIssue(
        { id: other, host: "edu.localhost" },
        { ...base, version: 1 },
        { purge },
      ),
    ).toEqual({ ok: false, reason: "not_found" })
  })
})
