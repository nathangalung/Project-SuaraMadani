import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { RouterContextProvider } from "react-router"
import { migrate } from "../../db/migrate.ts"
import {
  insertOrg,
  insertRegions,
  resetData,
  superuserPool,
  testUrl,
} from "../../db/testing.ts"
import { publicMediaPath } from "../../server/files.server.ts"
import { sessionContext, tenantContext } from "../context.ts"
import * as signOut from "./account/sign-out.ts"
import * as auth from "./api/auth.ts"
import * as upload from "./api/upload.ts"
import * as media from "./media.ts"
import * as regions from "./regions.ts"

const su = superuserPool()
const HOST = "rrt.localhost"
let orgId = ""
let filesDir = ""
const savedFilesDir = process.env.FILES_DIR

function context() {
  const provider = new RouterContextProvider()
  provider.set(tenantContext, {
    id: orgId,
    slug: "rrt",
    host: HOST,
    name: "KM RRT",
    campusCode: "RRT",
    campusName: "Kampus RRT",
    theme: {},
    settings: {},
  })
  provider.set(sessionContext, null)
  return provider
}

// Route args need url, pattern
function args(request: Request, params: Record<string, string> = {}): never {
  return {
    request,
    context: context(),
    params,
    url: new URL(request.url),
    pattern: "",
  } as never
}

// Server requests carry Host
const at = (path: string, init: RequestInit = {}) => {
  const headers = new Headers(init.headers)
  headers.set("host", HOST)
  return new Request(`http://${HOST}${path}`, { ...init, headers })
}

async function statusOf(run: () => Promise<unknown>): Promise<number> {
  try {
    const result = await run()
    return result instanceof Response ? result.status : 200
  } catch (error) {
    if (error instanceof Response) return error.status
    return (error as { init?: { status?: number } }).init?.status ?? 500
  }
}

beforeAll(async () => {
  await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
  await resetData(su)
  await insertRegions(su)
  orgId = await insertOrg(su, "rrt")
  filesDir = await mkdtemp(join(tmpdir(), "sb-media-"))
  process.env.FILES_DIR = filesDir
})

afterAll(async () => {
  if (savedFilesDir === undefined) delete process.env.FILES_DIR
  else process.env.FILES_DIR = savedFilesDir
  await rm(filesDir, { recursive: true, force: true })
  await resetData(su)
  await su.end()
})

describe("region lists, /wilayah/:file", () => {
  test("Given a province, when its file is read, then its kab/kota come back cacheable for a day", async () => {
    const res = await regions.loader(
      args(at("/wilayah/32.json"), { file: "32.json" }),
    )
    expect(res.status).toBe(200)
    const list: { code: string; name: string }[] = await res.json()
    expect(list).toContainEqual({ code: "32.73", name: "Kota Bandung" })
    expect(list.every((region) => region.code.startsWith("32."))).toBe(true)
    expect(res.headers.get("Cache-Control")).toBe(
      "public, max-age=0, no-transform",
    )
    expect(res.headers.get("Cloudflare-CDN-Cache-Control")).toBe(
      "max-age=86400, stale-while-revalidate=30, stale-if-error=86400",
    )
  })

  test("the root file lists provinces", async () => {
    const res = await regions.loader(
      args(at("/wilayah/id.json"), { file: "id.json" }),
    )
    expect(await res.json()).toContainEqual({ code: "32", name: "Jawa Barat" })
  })

  test("an unknown parent or a malformed name is 404", async () => {
    for (const file of ["99.json", "32.txt", "../id.json"]) {
      expect(
        await statusOf(() =>
          regions.loader(args(at(`/wilayah/${file}`), { file })),
        ),
      ).toBe(404)
    }
  })
})

describe("public media, /media/:file", () => {
  const name = `${"c".repeat(64)}.webp`
  const video = `${"d".repeat(64)}.mp4`

  beforeAll(async () => {
    for (const [file, bytes] of [
      [name, "webp-bytes"],
      [video, "0123456789"],
    ] as const) {
      const path = publicMediaPath(filesDir, HOST, file)
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, bytes)
    }
  })

  test("Given a published copy on disk, when it is fetched, then it is served immutable and sandboxed", async () => {
    const res = await media.loader(args(at(`/media/${name}`), { file: name }))
    expect(res.status).toBe(200)
    expect(await res.text()).toBe("webp-bytes")
    expect(res.headers.get("Content-Type")).toBe("image/webp")
    expect(res.headers.get("Cache-Control")).toBe(
      "public, max-age=31536000, immutable",
    )
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff")
    expect(res.headers.get("Content-Security-Policy")).toBe(
      "sandbox; default-src 'none'",
    )
  })

  test("a video answers a range request with its slice", async () => {
    const res = await media.loader(
      args(at(`/media/${video}`, { headers: { range: "bytes=2-4" } }), {
        file: video,
      }),
    )
    expect(res.status).toBe(206)
    expect(res.headers.get("Content-Type")).toBe("video/mp4")
    expect(await res.text()).toBe("234")
  })

  test("a name outside the content-hash form or a missing file is 404", async () => {
    for (const file of [`${"e".repeat(64)}.webp`, "logo.png", "a.webp"]) {
      expect(
        await statusOf(() =>
          media.loader(args(at(`/media/${file}`), { file })),
        ),
      ).toBe(404)
    }
  })
})

describe("sign-out, /keluar", () => {
  test("a GET never signs out and goes home", async () => {
    const res = signOut.loader()
    expect(res.status).toBe(302)
    expect(res.headers.get("Location")).toBe("/")
  })

  test("Given a stale cookie and no session, when the form posts, then it redirects with 303 and clears the cookie", async () => {
    const res = await signOut.action(
      args(
        at("/keluar", {
          method: "POST",
          body: new URLSearchParams(),
          headers: { cookie: "sb.session_token=lama.tanda" },
        }),
      ),
    )
    expect(res.status).toBe(303)
    expect(res.headers.get("Location")).toBe("/")
    // Stale cookie cleared anyway
    expect(res.headers.getSetCookie()).toContainEqual(
      expect.stringMatching(/^sb\.session_token=; Max-Age=0;/),
    )
  })

  test("only the sign-in page is an allowed next target", async () => {
    const to = async (next: string) =>
      (
        await signOut.action(
          args(
            at("/keluar", {
              method: "POST",
              body: new URLSearchParams({ next }),
            }),
          ),
        )
      ).headers.get("Location")
    expect(await to("/masuk")).toBe("/masuk")
    expect(await to("https://jahat.contoh")).toBe("/")
  })
})

describe("auth API, /api/auth/*", () => {
  test("the session read is not routed, its token never leaves", async () => {
    const res = await auth.loader(
      args(at("/api/auth/get-session"), { "*": "get-session" }),
    )
    expect(res.status).toBe(404)
  })

  test("Given no session, when sign-out is posted, then the handler answers success", async () => {
    const res = await auth.action(
      args(
        at("/api/auth/sign-out", {
          method: "POST",
          headers: {
            origin: `http://${HOST}`,
            "content-type": "application/json",
          },
          body: "{}",
        }),
        { "*": "sign-out" },
      ),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true })
  })
})

describe("upload API, /api/upload/:evidenceId", () => {
  const evidenceId = crypto.randomUUID()

  test("OPTIONS advertises tus", async () => {
    const res = await upload.action(
      args(at(`/api/upload/${evidenceId}`, { method: "OPTIONS" }), {
        evidenceId,
      }),
    )
    expect(res.status).toBe(204)
    expect(res.headers.get("Tus-Version")).toBe("1.0.0")
  })

  test("GET is not a tus method", async () => {
    const res = await upload.loader(
      args(at(`/api/upload/${evidenceId}`), { evidenceId }),
    )
    expect(res.status).toBe(405)
  })

  test("HEAD without the tus header is refused before any lookup", async () => {
    const res = await upload.loader(
      args(at(`/api/upload/${evidenceId}`, { method: "HEAD" }), {
        evidenceId,
      }),
    )
    expect(res.status).toBe(412)
  })
})
