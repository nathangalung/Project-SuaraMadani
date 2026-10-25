// Backend scenarios over HTTP only
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { connect, type Socket } from "node:net"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  type APIRequestContext,
  type APIResponse,
  expect,
  test,
} from "@playwright/test"
import { STAFF_STATE } from "./global-setup.ts"

const HERE = dirname(fileURLToPath(import.meta.url))
const TENANT = new URL(process.env.E2E_BASE_URL ?? "http://itb.localhost")
  .hostname
const OTHER = process.env.E2E_OTHER_HOST ?? "ugm.localhost"
const APEX = process.env.APEX_HOST || "localhost"
const ORIGIN = `https://${TENANT}`
const LICENSE = "https://creativecommons.org/licenses/by/4.0/"
const PNG = join(HERE, ".auth", "api-evidence.png")
const HSTS = process.env.HSTS_POLICY || "max-age=300"
// Unit test list, kept equal
const PII_KEYS =
  /^(email|phone|phoneNumber|phone_number|userId|user_id|ipAddress|ip_address|userAgent|user_agent|createdBy|decidedBy|name|story|point|lat|lng|declaredName|contact|addressHash|clientHash)$/i

type Fixture = {
  cookie: string
  evidenceId: string
  size: number
  unpublishedIssue: string | null
  takenDownIssue: string | null
  draftDemand: string | null
}

let fixture: Fixture

// Writes rows to target DB
test.beforeAll(() => {
  const out = execFileSync(
    "bun",
    ["--env-file=.env", "e2e/api-fixtures.ts", TENANT, PNG],
    { cwd: join(HERE, ".."), encoding: "utf8" },
  )
  fixture = JSON.parse(out.trim().split("\n").at(-1) ?? "{}") as Fixture
})

/** Fresh bucket for every test. */
function clientIp(): string {
  const byte = () => Math.floor(Math.random() * 254) + 1
  return `10.${byte()}.${byte()}.${byte()}`
}

/** Caddy-shaped headers for a host. */
function via(host: string, ip: string, extra: Record<string, string> = {}) {
  return {
    Host: host,
    "X-Forwarded-Proto": "https",
    "X-Client-IP": ip,
    ...extra,
  }
}

function piiIn(value: unknown, path = "$"): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((one, i) => piiIn(one, `${path}[${i}]`))
  }
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, one]) => [
      ...(PII_KEYS.test(key) ? [`${path}.${key}`] : []),
      ...piiIn(one, `${path}.${key}`),
    ])
  }
  return typeof value === "string" && /\S+@\S+\.\S+/.test(value)
    ? [`${path}=${value}`]
    : []
}

function csvLines(text: string): string[] {
  expect(text.endsWith("\r\n")).toBe(true)
  expect(text.replaceAll("\r\n", "")).not.toContain("\n")
  return text.slice(0, -2).split("\r\n")
}

async function json(res: APIResponse): Promise<Record<string, unknown>> {
  expect(res.headers()["content-type"]).toMatch(/^application\/json/)
  return (await res.json()) as Record<string, unknown>
}

type ListedIssue = { code: string; title: string; publishedAt: string }

/** Every page, following next. */
async function listIssues(
  request: APIRequestContext,
  host: string,
): Promise<ListedIssue[]> {
  const listed: ListedIssue[] = []
  let path: string | null = "/api/v1/isu"
  while (path) {
    const res = await request.get(path, { headers: via(host, clientIp()) })
    expect(res.status(), path).toBe(200)
    const body = (await res.json()) as {
      issues: ListedIssue[]
      next: string | null
    }
    listed.push(...body.issues)
    path = body.next
      ? `${new URL(body.next).pathname}${new URL(body.next).search}`
      : null
  }
  return listed
}

// Codes repeat across campuses
const identity = (issue: ListedIssue) =>
  `${issue.code}|${issue.title}|${issue.publishedAt}`

test.describe("public data API", () => {
  test("a data user reads the issue list as JSON with the CC BY 4.0 licence in the body and the Link header", async ({
    request,
  }) => {
    const res = await request.get("/api/v1/isu", {
      headers: via(TENANT, clientIp()),
    })
    expect(res.status()).toBe(200)
    const headers = res.headers()
    expect(headers.link).toContain(`<${LICENSE}>; rel="license"`)
    expect(headers.link).toContain(
      `<${ORIGIN}/isu>; rel="alternate"; type="text/html"`,
    )
    expect(headers["cache-control"]).toBe("public, max-age=0, no-transform")
    const body = await json(res)
    expect(body.meta).toMatchObject({
      license: "CC-BY-4.0",
      licenseUrl: LICENSE,
      source: `${ORIGIN}/isu`,
    })
    const meta = body.meta as { attribution: string }
    expect(meta.attribution).toContain("CC BY 4.0")
    const issues = body.issues as { url: string; api: string }[]
    expect(issues.length).toBeGreaterThan(0)
    // Monthly code since 22 Oct
    const code = String.raw`ISU-\d{4}-(0[1-9]|1[0-2])-\d{4,6}$`
    for (const issue of issues) {
      expect(issue.url).toMatch(new RegExp(`^${ORIGIN}/isu/${code}`))
      expect(issue.api).toMatch(new RegExp(`^${ORIGIN}/api/v1/isu/${code}`))
    }
  })

  test("a data user downloads a dashboard table as CSV with the same rows as the JSON", async ({
    request,
  }) => {
    const headers = via(TENANT, clientIp())
    const data = await json(await request.get("/api/v1/data", { headers }))
    const meta = data.meta as {
      license: string
      readme: string
      datasets: { id: string; columns: string[]; csv: string }[]
    }
    expect(meta.license).toBe("CC-BY-4.0")
    expect(meta.readme).toBe(`${ORIGIN}/api/v1/data/README.txt`)
    const tren = meta.datasets.find((one) => one.id === "tren")
    expect(tren?.csv).toBe(`${ORIGIN}/api/v1/data/tren.csv`)
    const rows = (data.datasets as Record<string, Record<string, unknown>[]>)
      .tren
    expect(rows?.length).toBeGreaterThan(0)

    const res = await request.get("/api/v1/data/tren.csv", { headers })
    expect(res.status()).toBe(200)
    expect(res.headers()["content-type"]).toBe(
      "text/csv; charset=utf-8; header=present",
    )
    expect(res.headers()["content-disposition"]).toBe(
      `attachment; filename="${TENANT.split(".")[0]}-tren.csv"`,
    )
    const link = res.headers().link
    expect(link).toContain(`<${LICENSE}>; rel="license"`)
    expect(link).toContain(`<${ORIGIN}/api/v1/data>; rel="describedby"`)
    expect(link).toContain(`<${ORIGIN}/api/v1/data/README.txt>; rel="help"`)
    const [header, ...lines] = csvLines(await res.text())
    expect(header).toBe(tren?.columns.join(","))
    expect(lines).toEqual(
      (rows ?? []).map((row) =>
        (tren?.columns ?? []).map((column) => String(row[column])).join(","),
      ),
    )
  })

  test("a repeat request with the ETag gets 304 Not Modified and no body", async ({
    request,
  }) => {
    const headers = via(TENANT, clientIp())
    const first = await request.get("/api/v1/isu", { headers })
    const etag = first.headers().etag
    expect(etag).toMatch(/^W\/"[0-9a-f]{40}"$/)
    const again = await request.get("/api/v1/isu", {
      headers: { ...headers, "If-None-Match": etag ?? "" },
    })
    expect(again.status()).toBe(304)
    expect(again.headers().etag).toBe(etag)
    expect(again.headers()["cache-control"]).toBe(
      "public, max-age=0, no-transform",
    )
    expect((await again.body()).length).toBe(0)
  })

  test("another website may read the API but never with credentials and never write", async ({
    request,
  }) => {
    const headers = via(TENANT, clientIp(), {
      Origin: "https://contoh.example",
    })
    const read = await request.get("/api/v1/data/tren.csv", { headers })
    expect(read.status()).toBe(200)
    expect(read.headers()["access-control-allow-origin"]).toBe("*")
    expect(read.headers()["access-control-allow-credentials"]).toBeUndefined()
    expect(read.headers()["access-control-expose-headers"]).toBe("ETag,Link")

    const preflight = await request.fetch("/api/v1/isu", {
      method: "OPTIONS",
      headers: { ...headers, "Access-Control-Request-Method": "POST" },
    })
    expect(preflight.status()).toBe(204)
    expect(preflight.headers()["access-control-allow-methods"]).toBe("GET,HEAD")

    for (const method of ["POST", "PUT", "DELETE"]) {
      const write = await request.fetch("/api/v1/isu", { method, headers })
      expect(write.status()).toBe(405)
      expect(write.headers().allow).toBe("GET, HEAD")
      expect(write.headers()["cache-control"]).toBe("no-store")
      expect(await write.json()).toEqual({ error: "method_not_allowed" })
    }
  })

  test("counts from one to four are hidden in the region tables, never shown", async ({
    request,
  }) => {
    const headers = via(TENANT, clientIp())
    const data = await json(await request.get("/api/v1/data", { headers }))
    const meta = data.meta as { suppression: { minPublicN: number } }
    expect(meta.suppression.minPublicN).toBe(5)
    const tables = data.datasets as Record<string, Record<string, unknown>[]>
    const counted = {
      wilayah: "verified_reports",
      "wilayah-total": "verified_reports",
    }
    for (const [id, column] of Object.entries(counted)) {
      const values = (tables[id] ?? []).map((row) => row[column])
      expect(values.length).toBeGreaterThan(0)
      const shown = values.filter((v): v is number => typeof v === "number")
      expect(shown.filter((v) => v > 0 && v < 5)).toEqual([])
      expect(shown.length + values.filter((v) => v === null).length).toBe(
        values.length,
      )
    }
    // Sample data has hidden cells
    const hidden = (tables.wilayah ?? []).filter(
      (row) => row.verified_reports === null,
    ).length
    expect(hidden).toBeGreaterThan(0)

    const csv = await request.get("/api/v1/data/wilayah.csv", { headers })
    const [header, ...lines] = csvLines(await csv.text())
    expect(header?.endsWith(",verified_reports")).toBe(true)
    const last = lines.map((line) => line.slice(line.lastIndexOf(",") + 1))
    expect(last.filter((cell) => cell === "").length).toBe(hidden)
    expect(last.filter((cell) => /^[1-4]$/.test(cell))).toEqual([])
  })

  test("an unpublished issue, a draft tuntutan and an unknown code answer 404, another campus's issue is never served, a removed issue 410", async ({
    request,
  }) => {
    const headers = via(TENANT, clientIp())
    const notFound = async (path: string) => {
      const res = await request.get(path, { headers })
      expect(res.status(), path).toBe(404)
      expect(res.headers()["cache-control"]).toBe("no-store")
      expect(await res.json()).toEqual({ error: "not_found" })
    }
    expect(fixture.unpublishedIssue).not.toBeNull()
    expect(fixture.draftDemand).not.toBeNull()
    await notFound(`/api/v1/isu/${fixture.unpublishedIssue}`)
    await notFound(`/api/v1/tuntutan/${fixture.draftDemand}`)

    // Same code, never their issue
    const theirs = await listIssues(request, OTHER)
    expect(theirs.length).toBeGreaterThan(0)
    for (const foreign of theirs) {
      const own = await request.get(`/api/v1/isu/${foreign.code}`, {
        headers: via(OTHER, clientIp()),
      })
      expect(own.status()).toBe(200)
      const here = await request.get(`/api/v1/isu/${foreign.code}`, {
        headers: via(TENANT, clientIp()),
      })
      if (here.status() === 404) continue
      expect(here.status(), foreign.code).toBe(200)
      const { issue } = (await here.json()) as { issue: ListedIssue }
      expect(identity(issue)).not.toBe(identity(foreign))
    }
    await notFound("/api/v1/isu/ISU-2020-01-9999")

    expect(fixture.takenDownIssue).not.toBeNull()
    const gone = await request.get(`/api/v1/isu/${fixture.takenDownIssue}`, {
      headers,
    })
    expect(gone.status()).toBe(410)
    const body = await gone.json()
    expect(Object.keys(body).sort()).toEqual(["error", "reason", "takenDownAt"])
    expect(body.error).toBe("taken_down")
  })

  test("no API answer carries a personal field or an email address", async ({
    request,
  }) => {
    const headers = via(TENANT, clientIp())
    const issue = (await listIssues(request, TENANT))[0]?.code
    const demands = await json(
      await request.get("/api/v1/tuntutan", { headers }),
    )
    const [demand] = demands.demands as { code: string }[]
    expect(issue).toBeDefined()
    expect(demand).toBeDefined()
    const paths = [
      "/api/v1",
      "/api/v1/isu",
      `/api/v1/isu/${issue}`,
      `/api/v1/tuntutan/${demand?.code}`,
      "/api/v1/data",
    ]
    expect(piiIn(demands)).toEqual([])
    for (const path of paths) {
      const res = await request.get(path, { headers })
      expect(res.status(), path).toBe(200)
      expect(piiIn(await res.json()), path).toEqual([])
    }
    const readme = await request.get("/api/v1/data/README.txt", { headers })
    expect(await readme.text()).not.toMatch(/\S+@\S+\.\S+/)
  })
})

test.describe
  .serial("resumable evidence upload", () => {
    let file: Buffer
    let ip: string
    const url = () => `/api/upload/${fixture.evidenceId}`
    const tus = (extra: Record<string, string> = {}) =>
      via(TENANT, ip, {
        Origin: ORIGIN,
        Cookie: fixture.cookie,
        "Tus-Resumable": "1.0.0",
        ...extra,
      })
    const offset = async (request: APIRequestContext) => {
      const res = await request.head(url(), { headers: tus() })
      expect(res.status()).toBe(200)
      expect(res.headers()["upload-length"]).toBe(String(fixture.size))
      return Number(res.headers()["upload-offset"])
    }

    test.beforeAll(() => {
      file = readFileSync(PNG)
      ip = clientIp()
    })

    test("the report's evidence row is ready for a resumable upload from byte zero", async ({
      request,
    }) => {
      expect(file.length).toBe(fixture.size)
      const head = await request.head(url(), { headers: tus() })
      expect(head.status()).toBe(200)
      expect(head.headers()["upload-offset"]).toBe("0")
      expect(head.headers()["tus-resumable"]).toBe("1.0.0")
      expect(head.headers()["cache-control"]).toBe("private, no-store")
      const options = await request.fetch(url(), {
        method: "OPTIONS",
        headers: tus(),
      })
      expect(options.status()).toBe(204)
      expect(options.headers()["tus-version"]).toBe("1.0.0")
      expect(options.headers()["tus-max-size"]).toBe("52428800")
    })

    test("more bytes than the declared file are refused and nothing is stored", async ({
      request,
    }) => {
      const res = await request.patch(url(), {
        headers: tus({
          "Content-Type": "application/offset+octet-stream",
          "Upload-Offset": "0",
        }),
        data: Buffer.concat([file, Buffer.from([0])]),
      })
      expect(res.status()).toBe(413)
      expect(await res.json()).toEqual({ error: "too_large" })
      expect(await offset(request)).toBe(0)
    })

    test("no session, another account, another campus, another site or no tus header is refused", async ({
      request,
    }) => {
      const octets = {
        "Content-Type": "application/offset+octet-stream",
        "Upload-Offset": "0",
      }
      const anonymous = via(TENANT, ip, {
        Origin: ORIGIN,
        "Tus-Resumable": "1.0.0",
      })
      expect((await request.head(url(), { headers: anonymous })).status()).toBe(
        401,
      )
      const patch = await request.patch(url(), {
        headers: { ...anonymous, ...octets },
        data: file.subarray(0, 16),
      })
      expect(patch.status()).toBe(401)
      expect(await patch.json()).toEqual({ error: "sign_in_required" })

      const staff = JSON.parse(readFileSync(STAFF_STATE, "utf8")) as {
        cookies: { name: string; value: string }[]
      }
      const staffCookie = staff.cookies
        .map((c) => `${c.name}=${c.value}`)
        .join("; ")
      const foreign = await request.head(url(), {
        headers: tus({ Cookie: staffCookie }),
      })
      expect(foreign.status()).toBe(404)

      const campus = await request.head(url(), {
        headers: { ...tus(), Host: OTHER, Origin: `https://${OTHER}` },
      })
      expect(campus.status()).toBe(404)

      const site = await request.patch(url(), {
        headers: tus({ ...octets, Origin: "https://jahat.example" }),
        data: file.subarray(0, 16),
      })
      expect(site.status()).toBe(403)

      const bare = await request.patch(url(), {
        headers: via(TENANT, ip, {
          Origin: ORIGIN,
          Cookie: fixture.cookie,
          ...octets,
        }),
        data: file.subarray(0, 16),
      })
      expect(bare.status()).toBe(412)
      expect(await offset(request)).toBe(0)
    })

    test("an upload cut off mid-file keeps its bytes and resumes from the stored offset", async ({
      request,
      baseURL,
    }) => {
      const cut = 8192
      const target = new URL(baseURL ?? "http://127.0.0.1:5198")
      // Request API cannot cut bodies
      const socket: Socket = connect(Number(target.port), target.hostname)
      socket.on("error", () => {})
      await new Promise<void>((resolve) => socket.once("connect", resolve))
      const lines = Object.entries(
        tus({
          "Content-Type": "application/offset+octet-stream",
          "Upload-Offset": "0",
          "Content-Length": String(file.length),
        }),
      ).map(([name, value]) => `${name}: ${value}`)
      socket.write(`PATCH ${url()} HTTP/1.1\r\n${lines.join("\r\n")}\r\n\r\n`)
      socket.write(file.subarray(0, cut))
      await expect.poll(() => offset(request)).toBe(cut)
      socket.destroy()
      expect(await offset(request)).toBe(cut)

      const wrong = await request.patch(url(), {
        headers: tus({
          "Content-Type": "application/offset+octet-stream",
          "Upload-Offset": "0",
        }),
        data: file.subarray(0, 16),
      })
      expect(wrong.status()).toBe(409)
      expect(await wrong.json()).toEqual({ error: "offset_mismatch" })

      const resume = await request.patch(url(), {
        headers: tus({
          "Content-Type": "application/offset+octet-stream",
          "Upload-Offset": String(cut),
        }),
        data: file.subarray(cut),
      })
      expect(resume.status()).toBe(204)
      expect(resume.headers()["upload-offset"]).toBe(String(file.length))
      expect(await offset(request)).toBe(file.length)
    })

    test("sending the finished file again stores nothing new", async ({
      request,
    }) => {
      // Run alone: finish it first
      const stored = await offset(request)
      if (stored < file.length) {
        const rest = await request.patch(url(), {
          headers: tus({
            "Content-Type": "application/offset+octet-stream",
            "Upload-Offset": String(stored),
          }),
          data: file.subarray(stored),
        })
        expect(rest.status()).toBe(204)
      }
      expect(await offset(request)).toBe(file.length)
      const again = await request.post(url(), {
        headers: via(TENANT, ip, { Origin: ORIGIN, Cookie: fixture.cookie }),
        data: file,
      })
      expect(again.status()).toBe(200)
      const body = await again.json()
      expect(body.status).not.toBe("awaiting_upload")
      expect(await offset(request)).toBe(file.length)
    })
  })

// Routes are the frontend's, unbuilt
test.describe("survey and right of reply", () => {
  test.fixme("a reporter answers the Sudah beres survey from the mailed link and the claim moves", () => {})
  test.fixme("a survey link that is expired, from an old round or for someone else is refused", () => {})
  test.fixme("a signed-in citizen rates a claimed resolution once and a second rating is refused", () => {})
  test.fixme("an agency sends a right of reply that waits for an admin, and a sixth in a day is refused", () => {})
})

test("the 21st sign-in lookup within a minute from one client gets 429, another client is unaffected", async ({
  request,
}) => {
  const ip = clientIp()
  const lookup = (from: string) =>
    request.post("/api/auth/account/lookup", {
      headers: via(TENANT, from, { Origin: ORIGIN }),
      data: { identifier: "tidak-terdaftar@contoh.test" },
    })
  for (let i = 1; i <= 20; i++) {
    expect((await lookup(ip)).status(), `request ${i}`).toBe(200)
  }
  const blocked = await lookup(ip)
  expect(blocked.status()).toBe(429)
  expect(Number(blocked.headers()["retry-after"])).toBeGreaterThan(0)
  expect(blocked.headers()["cache-control"]).toBe("no-store")
  expect((await lookup(clientIp())).status()).toBe(200)
})

test.describe("security headers", () => {
  test("a public page sends its CSP with frame-ancestors, HSTS as configured, nosniff, a referrer policy and Server-Timing", async ({
    request,
  }) => {
    const res = await request.get("/isu", { headers: via(TENANT, clientIp()) })
    expect(res.status()).toBe(200)
    const headers = res.headers()
    const csp = headers["content-security-policy"] ?? ""
    expect(csp).toContain("default-src 'self'")
    expect(csp).toMatch(/script-src 'strict-dynamic' 'self'( 'sha256-[^']+')+/)
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain("base-uri 'none'")
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).not.toContain("unsafe-eval")
    expect(headers["strict-transport-security"]).toBe(HSTS)
    expect(headers["x-content-type-options"]).toBe("nosniff")
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin")
    expect(headers["permissions-policy"]).toContain("camera=()")
    expect(headers["server-timing"]).toMatch(
      /^db;dur=[\d.]+;desc="\d+ queries", total;dur=[\d.]+$/,
    )
  })

  test("an API answer is locked down, and plain HTTP gets no HSTS", async ({
    request,
  }) => {
    const res = await request.get("/api/v1", {
      headers: { Host: TENANT, "X-Client-IP": clientIp() },
    })
    expect(res.status()).toBe(200)
    const headers = res.headers()
    expect(headers["content-security-policy"]).toBe(
      "default-src 'none'; frame-ancestors 'none'",
    )
    expect(headers["strict-transport-security"]).toBeUndefined()
    expect(headers["x-content-type-options"]).toBe("nosniff")
    expect(headers["server-timing"]).toMatch(
      /^db;dur=[\d.]+;desc="\d+ queries"/,
    )
  })
})

test("each campus host serves only its own data, the apex and unknown hosts serve none", async ({
  request,
}) => {
  const meta = async (host: string) => {
    const res = await request.get("/api/v1", { headers: via(host, clientIp()) })
    expect(res.status(), host).toBe(200)
    return ((await res.json()) as { meta: { source: string } }).meta
  }
  expect((await meta(TENANT)).source).toBe(`${ORIGIN}/data`)
  expect((await meta(OTHER)).source).toBe(`https://${OTHER}/data`)

  const mine = (await listIssues(request, TENANT)).map(identity)
  const theirs = (await listIssues(request, OTHER)).map(identity)
  expect(mine.length).toBeGreaterThan(0)
  expect(theirs.length).toBeGreaterThan(0)
  expect(mine.filter((one) => theirs.includes(one))).toEqual([])

  for (const host of [APEX, `tidak-ada.${APEX}`]) {
    const res = await request.get("/api/v1", { headers: via(host, clientIp()) })
    expect(res.status(), host).toBe(404)
  }
  // Non-canonical host is refused
  const loud = await request.get("/api/v1", {
    headers: via(TENANT.toUpperCase(), clientIp()),
  })
  expect(loud.status()).toBe(404)
})
