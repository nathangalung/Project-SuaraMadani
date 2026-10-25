import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { RouterContextProvider } from "react-router"
import { migrate } from "../../../db/migrate.ts"
import { reports } from "../../../db/schema/reports.ts"
import { withTenant } from "../../../db/tenant.server.ts"
import {
  insertOrg,
  insertRegions,
  insertUser,
  reportValues,
  resetData,
  superuserPool,
  testUrl,
} from "../../../db/testing.ts"
import {
  type LinkPurpose,
  linkExpiry,
  linkKeyring,
  signLink,
} from "../../../server/signed-link.ts"
import {
  type SessionContext,
  sessionContext,
  tenantContext,
} from "../../context.ts"
import { loader as trackLoader } from "../account/track"
import { action as detailAction, loader as detailLoader } from "./detail"
import { action as unfollowAction, loader as unfollowLoader } from "./unfollow"

process.env.LACAK_LINK_KEYS ||= `1:${Buffer.alloc(32, 9).toString("base64")}`

const su = superuserPool()
const CODE = "ISU-2026-10-0001"
const OTHER = "ISU-2026-10-0002"
const orgs = { a: "", b: "" }
let user = ""
let issueId = ""
let reportId = ""

function context(org: "a" | "b", signedIn: boolean) {
  const provider = new RouterContextProvider()
  const session: SessionContext | null = signedIn
    ? {
        user: {
          id: user,
          email: "ikut@contoh.id",
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
    slug: `frt${org}`,
    host: `frt${org}.localhost`,
    name: `KM FRT${org}`,
    campusCode: `FRT${org.toUpperCase()}`,
    campusName: `frt${org}`,
    theme: {},
    settings: {},
  })
  return provider
}

function token(
  purpose: LinkPurpose,
  subjectId: string,
  orgId = orgs.a,
  issuedAt = new Date(),
) {
  return signLink(linkKeyring(), {
    purpose,
    orgId,
    subjectId,
    userId: user,
    expiresAt: linkExpiry(issuedAt),
  })
}

function post(url: string, fields: Record<string, string>) {
  return new Request(url, {
    method: "POST",
    body: new URLSearchParams(fields),
  })
}

async function thrown(promise: Promise<unknown>): Promise<Response> {
  try {
    await promise
  } catch (error) {
    if (error instanceof Response) return error
    throw error
  }
  throw new Error("expected a thrown response")
}

async function following(): Promise<boolean> {
  const { rows } = await su.query(
    "SELECT 1 FROM follows WHERE user_id = $1 AND issue_id = $2",
    [user, issueId],
  )
  return rows.length > 0
}

beforeAll(async () => {
  await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
  await resetData(su)
  await insertRegions(su)
  orgs.a = await insertOrg(su, "frta")
  orgs.b = await insertOrg(su, "frtb")
  user = await insertUser(su, "ikut@contoh.id")
  const insert = async (code: string) => {
    const { rows } = await su.query<{ id: string }>(
      `INSERT INTO issues (org_id, year, number, public_code, title, summary,
         category_id, subcategory_id, province_code, regency_code, report_count, published_at)
       VALUES ($1, 2026, $2, $3, 'Judul isu', 'Ringkasan.', 'program',
         'program.pendidikan', '32', '32.73', 1, now()) RETURNING id`,
      [orgs.a, Number(code.slice(-1)), code],
    )
    return rows[0]?.id ?? ""
  }
  issueId = await insert(CODE)
  await insert(OTHER)
  const [row] = await withTenant(orgs.a, (tx) =>
    tx
      .insert(reports)
      .values(reportValues(orgs.a, user, { title: "Laporan lewat tautan" }))
      .returning({ id: reports.id }),
  )
  reportId = row?.id ?? ""
})

afterAll(async () => {
  await resetData(su)
  await su.end()
})

describe("follow on the issue page", () => {
  const page = `http://frta.localhost/isu/${CODE}`
  const args = (signedIn: boolean, request = new Request(page)) =>
    ({
      request,
      params: { code: CODE },
      context: context("a", signedIn),
    }) as unknown as Parameters<typeof detailLoader>[0]

  test("signed out: no follow state, page stays shareable", async () => {
    expect((await detailLoader(args(false))).follow).toBe(null)
  })

  test("signed out POST asks to sign in first", async () => {
    const res = await thrown(
      detailAction(args(false, post(page, { intent: "follow" }))),
    )
    expect(res.status).toBe(303)
    expect(res.headers.get("Location")).toBe(
      `/masuk?kembali=${encodeURIComponent(`/isu/${CODE}`)}`,
    )
  })

  test("follow and unfollow redirect back to the card", async () => {
    const res = await thrown(
      detailAction(args(true, post(page, { intent: "follow" }))),
    )
    expect(res.headers.get("Location")).toBe(`/isu/${CODE}#ikuti`)
    expect(await following()).toBe(true)
    expect((await detailLoader(args(true))).follow).toEqual({
      following: true,
      emailReady: true,
    })
    await thrown(detailAction(args(true, post(page, { intent: "unfollow" }))))
    expect(await following()).toBe(false)
  })

  test("an unknown intent is refused", async () => {
    const res = await thrown(
      detailAction(args(true, post(page, { intent: "x" }))),
    ).catch((error: { init?: { status?: number } }) => error)
    expect((res as { init?: { status?: number } }).init?.status).toBe(400)
  })
})

describe("signed unsubscribe link", () => {
  const url = (code: string, t: string) =>
    `http://frta.localhost/isu/${code}/berhenti?t=${t}`
  const args = (code: string, request: Request, org: "a" | "b" = "a") =>
    ({
      request,
      params: { code },
      context: context(org, false),
    }) as unknown as Parameters<typeof unfollowLoader>[0]

  test("GET only asks, POST unfollows", async () => {
    await su.query(
      "INSERT INTO follows (org_id, issue_id, user_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
      [orgs.a, issueId, user],
    )
    const t = token("berhenti", issueId)
    const shown = await unfollowLoader(args(CODE, new Request(url(CODE, t))))
    expect(shown.state).toBe("confirm")
    expect(await following()).toBe(true)
    const done = await unfollowAction(
      args(CODE, post(url(CODE, ""), { t })) as Parameters<
        typeof unfollowAction
      >[0],
    )
    expect(done).toEqual({ done: true })
    expect(await following()).toBe(false)
    const again = await unfollowLoader(args(CODE, new Request(url(CODE, t))))
    expect(again.state).toBe("not_following")
  })

  test("tampered, foreign, expired or mismatched tokens do nothing", async () => {
    const t = token("berhenti", issueId)
    const old = token(
      "berhenti",
      issueId,
      orgs.a,
      new Date(Date.now() - 31 * 86_400_000),
    )
    for (const [code, value, org] of [
      [CODE, `${t}x`, "a"],
      [CODE, token("lacak", issueId), "a"],
      [CODE, old, "a"],
      [OTHER, t, "a"],
      [CODE, t, "b"],
    ] as const) {
      const res = await unfollowLoader(
        args(code, new Request(url(code, value)), org),
      )
      expect(res.state).toBe("invalid")
    }
  })
})

describe("signed /lacak link", () => {
  const args = (t: string | null, org: "a" | "b" = "a", signedIn = false) =>
    ({
      request: new Request(
        `http://frta.localhost/lacak${t === null ? "" : `?t=${t}`}`,
      ),
      params: {},
      context: context(org, signedIn),
    }) as unknown as Parameters<typeof trackLoader>[0]

  test("a valid link shows that report without a session", async () => {
    const res = await trackLoader(args(token("lacak", reportId)))
    expect(res.link).toBe("valid")
    expect(res.own?.reports.map((r) => r.title)).toEqual([
      "Laporan lewat tautan",
    ])
  })

  test("after 30 days the link asks for sign-in", async () => {
    const old = token(
      "lacak",
      reportId,
      orgs.a,
      new Date(Date.now() - 30 * 86_400_000 - 1000),
    )
    const res = await trackLoader(args(old))
    expect(res).toMatchObject({ link: "invalid", own: null })
  })

  test("another campus or a bad token shows nothing", async () => {
    expect((await trackLoader(args(token("lacak", reportId), "b"))).own).toBe(
      null,
    )
    expect((await trackLoader(args("1.abc.def"))).link).toBe("invalid")
    expect((await trackLoader(args(null))).link).toBe(null)
  })

  test("signed in, /lacak lists followed issues", async () => {
    await su.query(
      "INSERT INTO follows (org_id, issue_id, user_id) SELECT org_id, id, $1 FROM issues WHERE public_code = $2 ON CONFLICT DO NOTHING",
      [user, OTHER],
    )
    const res = await trackLoader(args(null, "a", true))
    expect(res.followed?.issues.map((i) => i.code)).toContain(OTHER)
    // Signed out sees nothing
    expect((await trackLoader(args(null))).followed).toBeNull()
  })
})
