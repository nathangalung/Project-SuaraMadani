import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { RouterContextProvider } from "react-router"
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
  type SessionContext,
  sessionContext,
  tenantContext,
} from "../../context.ts"
import {
  action as statusAction,
  loader as statusLoader,
} from "../account/complaint"
import { action as formAction, loader as formLoader } from "./complaint"

const su = superuserPool()
const CODE = "ISU-2026-10-0001"
const DRAFT = "ISU-2026-10-0002"
const COMPLAINT = "ADU-CRT-26-7K3QX"
const orgs = { a: "", b: "" }
const users = { owner: "", other: "" }

function context(org: "a" | "b", user: string | null) {
  const provider = new RouterContextProvider()
  const session: SessionContext | null = user
    ? {
        user: {
          id: user,
          email: "pengadu@contoh.id",
          emailVerified: true,
          phoneVerified: true,
          name: "",
          twoFactorEnabled: false,
          updatedAt: new Date(),
        },
        session: {
          id: crypto.randomUUID(),
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 3_600_000),
        },
      }
    : null
  provider.set(sessionContext, session)
  provider.set(tenantContext, {
    id: orgs[org],
    slug: `crt${org}`,
    host: `crt${org}.localhost`,
    name: `KM CRT${org}`,
    campusCode: org === "a" ? "CRT" : "CRB",
    campusName: `crt${org}`,
    theme: {},
    settings: {},
  })
  return provider
}

type Args = { request: Request; params: { code: string }; context: unknown }

function args(url: string, code: string, ctx: RouterContextProvider): Args {
  return { request: new Request(url), params: { code }, context: ctx }
}

function post(url: string, fields: Record<string, string>) {
  return new Request(url, { method: "POST", body: new URLSearchParams(fields) })
}

async function thrown(promise: Promise<unknown>): Promise<{
  status: number
  location: string | null
}> {
  try {
    await promise
  } catch (error) {
    if (error instanceof Response) {
      return { status: error.status, location: error.headers.get("Location") }
    }
    const init = (error as { init?: { status?: number } }).init
    return { status: init?.status ?? 0, location: null }
  }
  throw new Error("expected a thrown response")
}

beforeAll(async () => {
  await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
  await resetData(su)
  await insertRegions(su)
  orgs.a = await insertOrg(su, "crta")
  orgs.b = await insertOrg(su, "crtb")
  users.owner = await insertUser(su, "pengadu.rute@contoh.id")
  users.other = await insertUser(su, "lain.rute@contoh.id")
  const { rows } = await su.query<{ id: string }>(
    `INSERT INTO issues (org_id, year, number, public_code, title, summary,
       category_id, subcategory_id, province_code, regency_code, report_count, published_at)
     VALUES ($1, 2026, 1, $2, 'Judul isu', 'Ringkasan.', 'program',
       'program.pendidikan', '32', '32.73', 1, now()),
       ($1, 2026, 2, $3, 'Draf', 'Ringkasan.', 'program',
       'program.pendidikan', '32', '32.73', 1, NULL)
     RETURNING id`,
    [orgs.a, CODE, DRAFT],
  )
  await su.query(
    `INSERT INTO content_complaints (org_id, issue_id, public_code, user_id,
       submission_id, reason, part, explanation, status, decision,
       decision_reason, decision_text, decided_by, decided_at)
     VALUES ($1, $2, $3, $4, gen_random_uuid(), 'personal_data', 'whole',
       'Ringkasan menyebut alamat rumah.', 'decided', 'keep', 'no_violation',
       'Ringkasan tidak memuat alamat siapa pun.', $5, now())`,
    [orgs.a, rows[0]?.id, COMPLAINT, users.owner, users.other],
  )
})

afterAll(async () => {
  await resetData(su)
  await su.end()
})

describe("/isu/:code/laporkan", () => {
  const url = `http://crta.localhost/isu/${CODE}/laporkan`

  test("a published issue shows the form, sign-in first", async () => {
    const data = await formLoader(
      args(url, CODE, context("a", null)) as Parameters<typeof formLoader>[0],
    )
    expect(data.issue).toEqual({ code: CODE, title: "Judul isu" })
    expect(data.signedInAs).toBeNull()
  })

  test("drafts, other campuses and odd codes", async () => {
    const draft = await thrown(
      formLoader(
        args(url, DRAFT, context("a", null)) as Parameters<
          typeof formLoader
        >[0],
      ),
    )
    expect(draft.status).toBe(404)
    const crossed = await thrown(
      formLoader(
        args(url, CODE, context("b", null)) as Parameters<typeof formLoader>[0],
      ),
    )
    expect(crossed.status).toBe(404)
    const lower = await thrown(
      formLoader(
        args(url, CODE.toLowerCase(), context("a", null)) as Parameters<
          typeof formLoader
        >[0],
      ),
    )
    expect(lower).toEqual({ status: 301, location: `/isu/${CODE}/laporkan` })
  })

  test("signed out POST is 401, bad fields are 400", async () => {
    const out = await formAction({
      ...args(url, CODE, context("a", null)),
      request: post(url, { submissionId: crypto.randomUUID() }),
    } as Parameters<typeof formAction>[0])
    expect(out.init?.status).toBe(401)
    const bad = await formAction({
      ...args(url, CODE, context("a", users.owner)),
      request: post(url, {
        submissionId: crypto.randomUUID(),
        reason: "hate",
        part: "whole",
        explanation: "pendek",
      }),
    } as Parameters<typeof formAction>[0])
    expect(bad.init?.status).toBe(400)
    expect(bad.data).toEqual({ errors: ["explanation", "good_faith"] })
  })
})

describe("/aduan/:code", () => {
  const url = `http://crta.localhost/aduan/${COMPLAINT}`
  const load = (org: "a" | "b", user: string | null, code = COMPLAINT) =>
    statusLoader(
      args(url, code, context(org, user)) as Parameters<typeof statusLoader>[0],
    )

  test("signed out goes to sign in and comes back", async () => {
    expect(await thrown(load("a", null))).toEqual({
      status: 302,
      location: `/masuk?kembali=${encodeURIComponent(`/aduan/${COMPLAINT}`)}`,
    })
  })

  test("only the complainant on this campus", async () => {
    const own = await load("a", users.owner)
    expect(own.complaint.code).toBe(COMPLAINT)
    expect(own.complaint.canAppeal).toBe(true)
    expect((await thrown(load("a", users.other))).status).toBe(404)
    expect((await thrown(load("b", users.owner))).status).toBe(404)
  })

  test("one appeal, then the form closes", async () => {
    const appeal = (user: string) =>
      statusAction({
        ...args(url, COMPLAINT, context("a", user)),
        request: post(url, {
          appeal: "Alamat masih tampil di paragraf kedua ringkasan.",
        }),
      } as Parameters<typeof statusAction>[0])
    expect((await thrown(appeal(users.other))).status).toBe(404)
    expect(await thrown(appeal(users.owner))).toEqual({
      status: 303,
      location: `/aduan/${COMPLAINT}#keputusan`,
    })
    const again = await appeal(users.owner)
    expect(again.init?.status).toBe(400)
    expect(again.data).toEqual({ error: "closed" })
    expect((await load("a", users.owner)).complaint.status).toBe("appealed")
  })
})
