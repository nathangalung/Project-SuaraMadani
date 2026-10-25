import { describe, expect, spyOn, test } from "bun:test"
import { createHash } from "node:crypto"
import {
  cacheProblem,
  hstsProblem,
  missingScriptHashes,
  type Net,
  plainApiProblem,
  plainPageProblem,
  sessionProblem,
  smoke,
  tlsAccepts,
  tlsProblems,
} from "./smoke.ts"

const sha = (text: string) =>
  `'sha256-${createHash("sha256").update(text).digest("base64")}'`

describe("missingScriptHashes", () => {
  const html = [
    "<script>window.a=1</script>",
    '<script type="module">import "/assets/x.js"</script>',
    '<script src="/assets/y.js"></script>',
    '<script type="application/ld+json">{"a":1}</script>',
  ].join("")

  test("all inline scripts hashed passes", () => {
    const csp = `script-src 'strict-dynamic' 'self' ${sha("window.a=1")} ${sha('import "/assets/x.js"')}`
    expect(missingScriptHashes(html, csp)).toEqual([])
  })

  test("names each unhashed inline script", () => {
    const csp = `default-src 'self'; script-src 'self' ${sha("window.a=1")}`
    expect(missingScriptHashes(html, csp)).toEqual([
      sha('import "/assets/x.js"'),
    ])
  })

  test("hashes outside script-src do not count", () => {
    const csp = `style-src ${sha("window.a=1")}; script-src 'self'`
    expect(missingScriptHashes("<script>window.a=1</script>", csp)).toEqual([
      sha("window.a=1"),
    ])
  })
})

describe("cacheProblem", () => {
  const anon = {
    status: 200,
    cacheStatus: "HIT",
    cacheControl: "public, max-age=0, no-transform",
  }

  test("a second anonymous HIT passes", () => {
    expect(cacheProblem(anon)).toBeNull()
  })

  test("a MISS on the second try fails", () => {
    expect(cacheProblem({ ...anon, cacheStatus: "MISS" })).toContain("MISS")
  })

  test("an error status fails", () => {
    expect(cacheProblem({ ...anon, status: 503 })).toContain("503")
  })
})

describe("sessionProblem", () => {
  test("bypass with private no-store passes", () => {
    expect(
      sessionProblem({
        status: 200,
        cacheStatus: "BYPASS",
        cacheControl: "private, no-store",
      }),
    ).toBeNull()
  })

  test("a cached session response fails", () => {
    expect(
      sessionProblem({
        status: 200,
        cacheStatus: "HIT",
        cacheControl: "private, no-store",
      }),
    ).toContain("HIT")
  })

  test("a public header on a session response fails", () => {
    expect(
      sessionProblem({
        status: 200,
        cacheStatus: "BYPASS",
        cacheControl: "public, max-age=0",
      }),
    ).toContain("public")
  })
})

describe("tlsProblems", () => {
  // ASVS V12.1.1: 1.2 floor
  const edge = {
    TLSv1: false,
    "TLSv1.1": false,
    "TLSv1.2": true,
    "TLSv1.3": true,
  }

  test("1.2 and 1.3 only passes", () => {
    expect(tlsProblems(edge)).toEqual([])
  })

  test("names each old version accepted", () => {
    expect(tlsProblems({ ...edge, TLSv1: true, "TLSv1.1": true })).toEqual([
      "TLSv1 accepted",
      "TLSv1.1 accepted",
    ])
  })

  test("TLS 1.3 off or 1.2 refused fails", () => {
    expect(tlsProblems({ ...edge, "TLSv1.3": false })).toEqual([
      "TLSv1.3 refused",
    ])
    expect(tlsProblems({ ...edge, "TLSv1.2": false })).toEqual([
      "TLSv1.2 refused",
    ])
  })
})

describe("plainPageProblem", () => {
  // ASVS V12.2.1: Single Redirect
  test("301 to the same https page passes", () => {
    expect(
      plainPageProblem("itb.contoh.id", {
        status: 301,
        location: "https://itb.contoh.id/",
      }),
    ).toBeNull()
  })

  test("a page served over http fails", () => {
    expect(
      plainPageProblem("itb.contoh.id", { status: 200, location: "" }),
    ).toContain("200")
  })

  test("a redirect elsewhere fails", () => {
    expect(
      plainPageProblem("itb.contoh.id", {
        status: 301,
        location: "http://itb.contoh.id/",
      }),
    ).toContain("http://itb.contoh.id/")
  })
})

describe("plainApiProblem", () => {
  // ASVS V4.1.2: block, never redirect
  test("a WAF block passes", () => {
    expect(plainApiProblem({ status: 403, location: "" })).toBeNull()
  })

  test("a redirect or an answer fails", () => {
    expect(
      plainApiProblem({ status: 301, location: "https://x/api/v1" }),
    ).toContain("301")
    expect(plainApiProblem({ status: 200, location: "" })).toContain("200")
  })
})

describe("hstsProblem", () => {
  test("a positive max-age passes", () => {
    expect(hstsProblem("max-age=300")).toBeNull()
    expect(hstsProblem("max-age=31536000; includeSubDomains")).toBeNull()
  })

  test("missing or zero fails", () => {
    expect(hstsProblem("")).toContain("missing")
    expect(hstsProblem("max-age=0")).toContain("max-age=0")
  })
})

type Answer = {
  status?: number
  headers?: Record<string, string>
  body?: string
}

/** Fake CDN, answers in order. */
function fakeNet(
  answers: Record<string, Answer[]>,
  tls: Partial<Record<string, boolean>> = {},
) {
  const requests: { url: string; cookie: string | null }[] = []
  const sleeps: number[] = []
  const net: Net = {
    fetch: async (url, init) => {
      requests.push({ url, cookie: new Headers(init.headers).get("cookie") })
      const queue = answers[url] ?? []
      const answer = (queue.length > 1 ? queue.shift() : queue[0]) ?? {}
      return new Response(answer.body ?? "", {
        status: answer.status ?? 200,
        headers: answer.headers ?? {},
      })
    },
    tlsAccepts: async (_host, version) => tls[version] === true,
    sleep: async (ms) => {
      sleeps.push(ms)
    },
  }
  return { net, requests, sleeps }
}

async function run(args: string[], net: Net) {
  const out = spyOn(console, "log").mockImplementation(() => {})
  const err = spyOn(console, "error").mockImplementation(() => {})
  try {
    const code = await smoke(args, net)
    return {
      code,
      summary: JSON.parse(String(out.mock.calls[0]?.[0])),
      problems: err.mock.calls.map(([line]) => String(line)),
    }
  } finally {
    out.mockRestore()
    err.mockRestore()
  }
}

const PAGE = "https://itb.sadarbersuara.id/"
const page = (cache: string): Answer => ({
  headers: {
    "cf-cache-status": cache,
    "cache-control": "public, max-age=0",
    "content-security-policy": `script-src 'self' ${sha("window.a=1")}`,
  },
  body: "<script>window.a=1</script>",
})
const privatePage: Answer = {
  headers: {
    "cf-cache-status": "BYPASS",
    "cache-control": "private, no-store",
  },
}

describe("smoke", () => {
  test("Given a cold cache, when the second try HITs, then the release passes", async () => {
    const { net, requests, sleeps } = fakeNet({
      [PAGE]: [page("MISS"), page("MISS"), page("HIT"), privatePage],
    })
    const result = await run(["itb.sadarbersuara.id"], net)
    expect(result).toEqual({
      code: 0,
      summary: { msg: "smoke", hosts: ["itb.sadarbersuara.id"], failed: 0 },
      problems: [],
    })
    expect(sleeps).toEqual([1000])
    expect(requests.at(-1)?.cookie).toBe("__Host-sb.session_token=smoke-test")
  })

  test("[AC-DEPLOY-02] Given a released campus host whose page never caches, has an unhashed inline script and a public session, when the smoke test runs, then it fails and names each problem for that host", async () => {
    const leaky: Answer = {
      headers: { "cf-cache-status": "HIT", "cache-control": "public" },
    }
    const { net, sleeps } = fakeNet({
      [PAGE]: [
        { ...page("MISS"), body: "<script>window.b=2</script>" },
        page("MISS"),
        page("MISS"),
        page("MISS"),
        page("MISS"),
        leaky,
      ],
    })
    const result = await run(["itb.sadarbersuara.id"], net)
    expect(result.code).toBe(1)
    expect(result.summary.failed).toBe(3)
    expect(result.problems).toEqual([
      "itb.sadarbersuara.id: anonymous cache MISS",
      `itb.sadarbersuara.id: inline script ${sha("window.b=2")} not in CSP`,
      "itb.sadarbersuara.id: session response was a HIT",
    ])
    expect(sleeps).toEqual([1000, 1000, 1000])
  })

  test("Given the Cloudflare checklist holds, when edge runs, then it passes", async () => {
    const host = "sadarbersuara.id"
    const { net } = fakeNet(
      {
        [`http://${host}/`]: [
          { status: 301, headers: { location: `https://${host}/` } },
        ],
        [`http://${host}/api/v1`]: [{ status: 403 }],
        [`https://${host}/`]: [
          { headers: { "strict-transport-security": "max-age=31536000" } },
        ],
      },
      { "TLSv1.2": true, "TLSv1.3": true },
    )
    const result = await run(["edge", host], net)
    expect(result).toEqual({
      code: 0,
      summary: { msg: "smoke edge", hosts: [host], failed: 0 },
      problems: [],
    })
  })

  test("Given an edge with old TLS, plain http and no HSTS, then each problem is named", async () => {
    const host = "sadarbersuara.id"
    const { net } = fakeNet({}, { TLSv1: true, "TLSv1.2": true })
    const result = await run(["edge", host], net)
    expect(result.code).toBe(1)
    expect(result.problems).toEqual([
      `${host}: TLSv1 accepted`,
      `${host}: TLSv1.3 refused`,
      `${host}: http:// answered 200 without Location, expected 301 to https://${host}/`,
      `${host}: http:// /api/v1 answered 200, expected the WAF block 403`,
      `${host}: Strict-Transport-Security missing`,
    ])
  })

  test("no hosts is a usage error", async () => {
    const { net, requests } = fakeNet({})
    await expect(smoke(["edge"], net)).rejects.toThrow("no hosts given")
    expect(requests).toEqual([])
  })
})

describe("tlsAccepts", () => {
  test("Given an endpoint that speaks no TLS, then no version counts as accepted", async () => {
    const plain = Bun.listen({
      hostname: "localhost",
      port: 0,
      socket: { open: (socket) => void socket.end(), data: () => {} },
    })
    try {
      expect(await tlsAccepts("localhost", "TLSv1.3", plain.port)).toBe(false)
    } finally {
      plain.stop(true)
    }
  })
})
