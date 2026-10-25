import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
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
import { cleanBriefPath } from "../../../server/files.server.ts"
import {
  linkExpiry,
  linkKeyring,
  signLink,
} from "../../../server/signed-link.ts"
import {
  type SessionContext,
  sessionContext,
  tenantContext,
} from "../../context.ts"
import {
  changeDemandState,
  createDemand,
  type DemandFields,
  type DemandTenant,
  getManagedDemand,
  publishBrief,
  uploadBrief,
} from "../../features/demands/manage.server.ts"
import { loader as briefLoader } from "./brief"
import { action as detailAction, loader as detailLoader } from "./detail"
import { loader as ogLoader } from "./og-image"
import { loader as rateLoader } from "./rate"
import { action as unfollowAction, loader as unfollowLoader } from "./unfollow"

process.env.LACAK_LINK_KEYS ||= `1:${Buffer.alloc(32, 9).toString("base64")}`
process.env.AUDIT_HMAC_KEY ||= Buffer.alloc(32, 7).toString("base64")

const su = superuserPool()
let tenant: DemandTenant
let admin = ""
let citizen = ""
let filesDir = ""
const savedFilesDir = process.env.FILES_DIR

const FIELDS: DemandFields = {
  scope: "regional",
  provinceCode: "32",
  regencyCode: "32.73",
  category: "kesehatan",
  title: "Layanan puskesmas buka hingga malam",
  body: "Kami menuntut puskesmas kecamatan membuka layanan sore hingga malam hari.",
  summary: "Jam layanan puskesmas diperpanjang hingga pukul sembilan malam.",
  target: "Dinas Kesehatan Kota Bandung",
  raisedOn: "2026-09-01",
}

function session(): SessionContext {
  return {
    user: {
      id: citizen,
      email: "warga.rute@contoh.id",
      emailVerified: true,
      phoneVerified: true,
      name: "Warga Rute",
      twoFactorEnabled: false,
      updatedAt: new Date(0),
    },
    session: {
      id: crypto.randomUUID(),
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 3_600_000),
    },
  }
}

function context(signedIn: boolean) {
  const provider = new RouterContextProvider()
  provider.set(tenantContext, {
    id: tenant.id,
    slug: "fdrt",
    host: tenant.host,
    name: "KM FDRT",
    campusCode: tenant.campusCode,
    campusName: "fdrt",
    theme: {},
    settings: {},
  })
  provider.set(sessionContext, signedIn ? session() : null)
  return provider
}

// Route args need url, pattern
function args(
  path: string,
  params: Record<string, string>,
  options: { signedIn?: boolean; form?: Record<string, string> } = {},
): never {
  const url = `http://fdrt.localhost${path}`
  const request = options.form
    ? new Request(url, {
        method: "POST",
        body: new URLSearchParams(options.form),
      })
    : new Request(url)
  return {
    request,
    params,
    context: context(options.signedIn ?? false),
    url: new URL(url),
    pattern: "",
  } as never
}

async function thrown(run: Promise<unknown>): Promise<Response | number> {
  try {
    await run
  } catch (error) {
    if (error instanceof Response) return error
    const status = (error as { init?: { status?: number } }).init?.status
    if (status) return status
    throw error
  }
  throw new Error("expected a thrown response")
}

async function make(publish = true): Promise<string> {
  const created = await createDemand(tenant, {
    fields: FIELDS,
    items: ["Jam layanan sore", "Dokter jaga malam"],
    actorId: admin,
  })
  if (!created.ok) throw new Error(created.reason)
  if (publish) await act(created.code, "publish")
  return created.code
}

async function act(code: string, action: "publish" | "close") {
  const done = await changeDemandState(tenant, {
    code,
    action,
    version: (await getManagedDemand(tenant.id, code))?.version ?? 0,
    note: action === "close" ? "Ditutup setelah audiensi terakhir." : null,
    actorId: admin,
  })
  if (!done.ok) throw new Error(done.reason)
}

async function demandId(code: string): Promise<string> {
  const demand = await getManagedDemand(tenant.id, code)
  if (!demand) throw new Error("no demand")
  return demand.id
}

async function follows(): Promise<number> {
  const { rows } = await su.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM demand_follows WHERE user_id = $1",
    [citizen],
  )
  return rows[0]?.n ?? 0
}

beforeAll(async () => {
  await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
  await resetData(su)
  await insertRegions(su)
  tenant = {
    id: await insertOrg(su, "fdrt"),
    host: "fdrt.localhost",
    campusCode: "FDRT",
  }
  admin = await insertUser(su, "admin.rute@contoh.id")
  citizen = await insertUser(su, "warga.rute@contoh.id")
  filesDir = await mkdtemp(join(tmpdir(), "sb-fdrt-"))
  process.env.FILES_DIR = filesDir
})

beforeEach(async () => {
  await su.query("DELETE FROM demands")
  await su.query("DELETE FROM org_counters")
  await su.query("DELETE FROM members WHERE user_id = $1", [citizen])
})

afterAll(async () => {
  if (savedFilesDir === undefined) delete process.env.FILES_DIR
  else process.env.FILES_DIR = savedFilesDir
  await rm(filesDir, { recursive: true, force: true })
  await resetData(su)
  await su.end()
})

describe("follow on the tuntutan page", () => {
  test("Given a signed-in citizen, when they follow, then they become a member and the page says following", async () => {
    const code = await make()
    const page = `/tuntutan/${code}`
    expect(
      (await detailLoader(args(page, { code }, { signedIn: true }))).follow,
    ).toEqual({
      following: false,
      emailReady: true,
    })
    const res = await thrown(
      detailAction(
        args(page, { code }, { signedIn: true, form: { intent: "follow" } }),
      ),
    )
    expect(res instanceof Response && res.headers.get("Location")).toBe(
      `/tuntutan/${code}#ikuti`,
    )
    expect(await follows()).toBe(1)
    const { rows } = await su.query(
      "SELECT role FROM members WHERE organization_id = $1 AND user_id = $2",
      [tenant.id, citizen],
    )
    expect(rows).toEqual([{ role: "reporter" }])
    expect(
      (await detailLoader(args(page, { code }, { signedIn: true }))).follow,
    ).toEqual({
      following: true,
      emailReady: true,
    })
    // Second follow is a no-op
    await thrown(
      detailAction(
        args(page, { code }, { signedIn: true, form: { intent: "follow" } }),
      ),
    )
    expect(await follows()).toBe(1)
    await thrown(
      detailAction(
        args(page, { code }, { signedIn: true, form: { intent: "unfollow" } }),
      ),
    )
    expect(await follows()).toBe(0)
  })

  test("a draft cannot be followed and stays 404", async () => {
    const code = await make(false)
    const res = await thrown(
      detailAction(
        args(
          `/tuntutan/${code}`,
          { code },
          { signedIn: true, form: { intent: "follow" } },
        ),
      ),
    )
    expect(res).toBe(404)
    expect(await follows()).toBe(0)
  })

  test("signed out asks to sign in, a bad intent or code is refused", async () => {
    const code = await make()
    const page = `/tuntutan/${code}`
    const out = await thrown(
      detailAction(args(page, { code }, { form: { intent: "follow" } })),
    )
    expect(out instanceof Response && out.status).toBe(303)
    expect(out instanceof Response && out.headers.get("Location")).toStartWith(
      "/masuk",
    )
    expect(
      await thrown(
        detailAction(
          args(page, { code }, { signedIn: true, form: { intent: "x" } }),
        ),
      ),
    ).toBe(400)
    expect(
      await thrown(
        detailAction(
          args(
            "/tuntutan/x",
            { code: "x" },
            { signedIn: true, form: { intent: "follow" } },
          ),
        ),
      ),
    ).toBe(404)
    expect((await detailLoader(args(page, { code }))).follow).toBeNull()
  })
})

describe("signed unfollow link", () => {
  const token = (subjectId: string) =>
    signLink(linkKeyring(), {
      purpose: "berhenti-tuntutan",
      orgId: tenant.id,
      subjectId,
      userId: citizen,
      expiresAt: linkExpiry(new Date()),
    })

  test("GET only asks, POST unfollows, then the link says not following", async () => {
    const code = await make()
    await thrown(
      detailAction(
        args(
          `/tuntutan/${code}`,
          { code },
          { signedIn: true, form: { intent: "follow" } },
        ),
      ),
    )
    const t = token(await demandId(code))
    const path = `/tuntutan/${code}/berhenti?t=${t}`
    expect(await unfollowLoader(args(path, { code }))).toMatchObject({
      state: "confirm",
      code,
      title: FIELDS.title,
    })
    expect(await follows()).toBe(1)
    expect(await unfollowAction(args(path, { code }, { form: { t } }))).toEqual(
      {
        done: true,
      },
    )
    expect(await follows()).toBe(0)
    expect((await unfollowLoader(args(path, { code }))).state).toBe(
      "not_following",
    )
  })

  test("a token for another tuntutan, a draft, or a bad token does nothing", async () => {
    const code = await make()
    const other = await make()
    const hidden = await make(false)
    await thrown(
      detailAction(
        args(
          `/tuntutan/${code}`,
          { code },
          { signedIn: true, form: { intent: "follow" } },
        ),
      ),
    )
    const foreign = token(await demandId(other))
    const draft = token(await demandId(hidden))
    for (const [path, t] of [
      [`/tuntutan/${code}/berhenti?t=${foreign}`, foreign],
      [`/tuntutan/${hidden}/berhenti?t=${draft}`, draft],
      [`/tuntutan/${code}/berhenti?t=rusak`, "rusak"],
    ] as const) {
      const at = path.split("/")[2] ?? ""
      expect((await unfollowLoader(args(path, { code: at }))).state).toBe(
        "invalid",
      )
      expect(
        await unfollowAction(args(path, { code: at }, { form: { t } })),
      ).toEqual({
        done: false,
      })
    }
    expect(await follows()).toBe(1)
  })
})

describe("old rating link", () => {
  test("Given the retired rating URL, when it is opened, then it moves permanently to the ranking page", async () => {
    const moved = await thrown(Promise.resolve().then(() => rateLoader()))
    expect(moved instanceof Response && moved.status).toBe(301)
    expect(moved instanceof Response && moved.headers.get("Location")).toBe(
      "/tuntutan/peringkat",
    )
  })
})

describe("share image", () => {
  test("Given an old or missing version, when the image is asked, then it redirects to the current one", async () => {
    const code = await make()
    const { version } = (await getManagedDemand(tenant.id, code)) ?? {
      version: 0,
    }
    const res = await ogLoader(args(`/tuntutan/${code}/og.png`, { code }))
    expect(res.status).toBe(301)
    expect(res.headers.get("Location")).toBe(
      `/tuntutan/${code}/og.png?v=${version}`,
    )
    expect(res.headers.get("Cache-Control")).toBe("no-store")
  })

  test("the current version renders an immutable PNG", async () => {
    const code = await make()
    const { version } = (await getManagedDemand(tenant.id, code)) ?? {
      version: 0,
    }
    const res = await ogLoader(
      args(`/tuntutan/${code}/og.png?v=${version}`, { code }),
    )
    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Type")).toBe("image/png")
    expect(res.headers.get("Cache-Control")).toBe(
      "public, max-age=31536000, immutable",
    )
    const bytes = new Uint8Array(await res.arrayBuffer())
    // PNG signature
    expect([...bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])
  })

  test("a draft or a malformed code has no image", async () => {
    const draft = await make(false)
    expect(
      await thrown(
        ogLoader(args(`/tuntutan/${draft}/og.png`, { code: draft })),
      ),
    ).toBe(404)
    expect(
      await thrown(ogLoader(args("/tuntutan/x/og.png", { code: "x" }))),
    ).toBe(404)
  })
})

describe("policy brief download", () => {
  const PDF = "%PDF-1.4\n% bersih\n"

  async function publishedBrief(code: string) {
    const item = (await getManagedDemand(tenant.id, code))?.items[1]
    if (!item) throw new Error("item")
    await uploadBrief(tenant, {
      code,
      itemId: item.id,
      bytes: new TextEncoder().encode(PDF),
      actorId: admin,
    })
    await su.query(
      "UPDATE policy_briefs SET status = 'clean', scanned_at = now()",
    )
    const briefId =
      (await getManagedDemand(tenant.id, code))?.items[1]?.briefs[0]?.id ?? ""
    const done = await publishBrief(tenant, { code, briefId, actorId: admin })
    if (!done.ok) throw new Error(done.reason)
    return briefId
  }

  async function writeClean(briefId: string) {
    const path = cleanBriefPath(filesDir, tenant.id, briefId)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, PDF)
  }

  test("Given a published, scanned brief, when it is downloaded, then the stripped PDF is an attachment", async () => {
    const code = await make()
    const briefId = await publishedBrief(code)
    await writeClean(briefId)
    const res = await briefLoader(
      args(`/tuntutan/${code}/dokumen/${briefId}.pdf`, {
        code,
        file: `${briefId}.pdf`,
      }),
    )
    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Type")).toBe("application/pdf")
    expect(res.headers.get("Content-Disposition")).toBe(
      `attachment; filename="${code}-sub-2-policy-brief.pdf"`,
    )
    expect(res.headers.get("Content-Security-Policy")).toBe(
      "sandbox; default-src 'none'",
    )
    expect(await res.text()).toBe(PDF)
  })

  test("a missing stripped copy, an unknown file, or another code is 404", async () => {
    const code = await make()
    const other = await make()
    const briefId = await publishedBrief(code)
    const file = `${briefId}.pdf`
    // Scan not finished writing
    expect(await thrown(briefLoader(args("/", { code, file })))).toBe(404)
    await writeClean(briefId)
    expect(await thrown(briefLoader(args("/", { code: other, file })))).toBe(
      404,
    )
    expect(
      await thrown(briefLoader(args("/", { code, file: `${briefId}.exe` }))),
    ).toBe(404)
    expect(await thrown(briefLoader(args("/", { code: "x", file })))).toBe(404)
  })

  test("an unpublished brief is never served", async () => {
    const code = await make()
    const item = (await getManagedDemand(tenant.id, code))?.items[0]
    if (!item) throw new Error("item")
    await uploadBrief(tenant, {
      code,
      itemId: item.id,
      bytes: new TextEncoder().encode(PDF),
      actorId: admin,
    })
    const briefId =
      (await getManagedDemand(tenant.id, code))?.items[0]?.briefs[0]?.id ?? ""
    await writeClean(briefId)
    expect(
      await thrown(briefLoader(args("/", { code, file: `${briefId}.pdf` }))),
    ).toBe(404)
  })
})
