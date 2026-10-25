import { describe, expect, spyOn, test } from "bun:test"
import {
  createErrorReporter,
  envelope,
  errorEvent,
  errorReporterFromEnv,
  parseDsn,
  stackFrames,
} from "./error-report.ts"
import { scrub } from "./scrub.ts"

// DSN public key shape
const KEY = "ab".repeat(16)
const DSN = parseDsn(`http://${KEY}@glitchtip:8000/1`)
const ROOT = "/app"

const EMAIL = "warga.rahasia@contoh.id"
const PHONES = ["+62 812-3456-7890", "081234567890", "6281234567890"]
const IPS = ["203.0.113.45", "2001:db8::1", "fe80::1ff:fe23:4567:890a"]

const BUN_STACK = `TypeError: boom
    at readIssue (/app/app/features/issues/read.server.ts:41:11)
    at async loader (/app/app/routes/issues/detail.tsx:12:20)
    at query (/app/node_modules/pg/lib/client.js:520:17)
    at processTicksAndRejections (native:7:39)`

type Call = { url: string; init: RequestInit }

function fakeFetch(respond: () => Promise<Response> | Response) {
  const calls: Call[] = []
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} })
    return respond()
  }
  return { fetch, calls }
}

function reporter(
  respond: () => Promise<Response> | Response,
  extra: { now?: () => number; maxInFlight?: number; timeoutMs?: number } = {},
) {
  const { fetch, calls } = fakeFetch(respond)
  const logs: Record<string, unknown>[] = []
  const report = createErrorReporter({
    dsn: DSN,
    release: "abc123",
    environment: "production",
    service: "web",
    root: ROOT,
    fetch,
    log: (line) => logs.push(line),
    ...extra,
  })
  return { report, calls, logs }
}

const record = {
  msg: "server error",
  path: "/isu/ISU-ITB-26-0001",
  error: "TypeError",
  message: "boom",
  stack: BUN_STACK,
}

describe("parseDsn", () => {
  test("internal DSN maps to the envelope endpoint", () => {
    expect(DSN).toEqual({
      endpoint: "http://glitchtip:8000/api/1/envelope/",
      key: KEY,
    })
  })

  test("keeps a path prefix", () => {
    expect(parseDsn(`https://${KEY}@errors.example.id/sub/42`).endpoint).toBe(
      "https://errors.example.id/sub/api/42/envelope/",
    )
  })

  test("refuses malformed values", () => {
    for (const bad of [
      "",
      "glitchtip:8000/1",
      `ftp://${KEY}@glitchtip/1`,
      "http://glitchtip:8000/1",
      `http://${KEY}@glitchtip:8000/`,
      `http://${KEY}@glitchtip:8000/abc`,
      `http://${KEY}:secret@glitchtip:8000/1`,
      `http://${KEY}@glitchtip:8000/1?x=1`,
      "http://short@glitchtip:8000/1",
    ]) {
      expect(() => parseDsn(bad)).toThrow("GLITCHTIP_DSN")
    }
  })
})

describe("scrub", () => {
  test("removes emails, phones and addresses", () => {
    const text = `to ${EMAIL} via ${PHONES.join(" or ")} from ${IPS.join(", ")}`
    const clean = scrub(text)
    expect(clean).not.toContain(EMAIL)
    for (const value of [...PHONES, ...IPS]) expect(clean).not.toContain(value)
    expect(clean).toContain("[email]")
    expect(clean).toContain("[number]")
    expect(clean).toContain("[ip]")
  })

  test("drops query strings", () => {
    expect(scrub('No route matches URL "/isu?cari=rahasia"')).toBe(
      'No route matches URL "/isu?[query]"',
    )
    expect(scrub("fetch https://x.id/a?token=abc failed")).toBe(
      "fetch https://x.id/a?[query] failed",
    )
  })

  test("keeps ordinary messages", () => {
    for (const text of [
      'duplicate key value violates unique constraint "reports_pkey"',
      "Cannot read properties of undefined (reading 'title')",
      "ses send failed: 403 UnrecognizedClientException",
      "timeout after 30s in 2 attempts",
    ]) {
      expect(scrub(text)).toBe(text)
    }
  })

  test("caps the length", () => {
    expect(scrub("a".repeat(5000)).length).toBeLessThanOrEqual(512)
  })
})

describe("stackFrames", () => {
  test("oldest first, relative, library frames marked", () => {
    expect(stackFrames(BUN_STACK, ROOT)).toEqual([
      {
        function: "processTicksAndRejections",
        filename: "native",
        lineno: 7,
        colno: 39,
        in_app: false,
      },
      {
        function: "query",
        filename: "node_modules/pg/lib/client.js",
        lineno: 520,
        colno: 17,
        in_app: false,
      },
      {
        function: "loader",
        filename: "app/routes/issues/detail.tsx",
        lineno: 12,
        colno: 20,
        in_app: true,
      },
      {
        function: "readIssue",
        filename: "app/features/issues/read.server.ts",
        lineno: 41,
        colno: 11,
        in_app: true,
      },
    ])
  })

  test("anonymous frames and junk", () => {
    expect(
      stackFrames("Error: x\n    at /app/server/a.ts:3:4\nnoise", ROOT),
    ).toEqual([{ filename: "server/a.ts", lineno: 3, colno: 4, in_app: true }])
    expect(stackFrames("", ROOT)).toEqual([])
  })
})

describe("errorEvent", () => {
  const context = {
    release: "abc123",
    environment: "production",
    service: "worker",
    root: ROOT,
  }

  test("builds an exception event from a log record", () => {
    const event = errorEvent(
      { ...record, queue: "email-send", job_id: "j-1", retry: 2 },
      context,
      1_700_000_000_000,
    )
    expect(event?.event_id).toMatch(/^[0-9a-f]{32}$/)
    expect(event).toMatchObject({
      timestamp: 1_700_000_000,
      platform: "node",
      level: "error",
      logger: "server error",
      transaction: "/isu/ISU-ITB-26-0001",
      release: "abc123",
      environment: "production",
      tags: {
        service: "worker",
        queue: "email-send",
        job_id: "j-1",
        retry: "2",
      },
    })
    const [exception] = event?.exception.values ?? []
    expect(exception?.type).toBe("TypeError")
    expect(exception?.value).toBe("boom")
    expect(exception?.stacktrace?.frames.at(-1)?.function).toBe("readIssue")
  })

  test("a database record keeps codes only", () => {
    const event = errorEvent(
      {
        msg: "job failed",
        error: "Error",
        code: "23505",
        constraint: "reports_pkey",
        table: "reports",
        routine: "_bt_check_unique",
      },
      context,
      0,
    )
    const [exception] = event?.exception.values ?? []
    expect(exception).toEqual({ type: "Error", value: "23505 reports_pkey" })
    expect(event?.tags).toMatchObject({
      code: "23505",
      constraint: "reports_pkey",
      table: "reports",
    })
  })

  test("records without an error are not events", () => {
    expect(errorEvent({ msg: "client error", status: 400 }, context, 0)).toBe(
      null,
    )
  })

  test("no personal data reaches the payload", () => {
    const event = errorEvent(
      {
        msg: `failed for ${EMAIL}`,
        path: "/lacak?t=secret-token",
        error: "Error",
        message: `send to ${EMAIL} ${PHONES[0]} from ${IPS[0]}`,
        stack: `Error: ${EMAIL}\n    at f (/app/server/a.ts:1:1)`,
        email: EMAIL,
        phone: PHONES[1],
        ip: IPS[1],
        body: "Isi laporan rahasia",
        user: { email: EMAIL },
      },
      context,
      0,
    )
    const json = JSON.stringify(event)
    for (const value of [
      EMAIL,
      ...PHONES,
      ...IPS,
      "secret-token",
      "Isi laporan rahasia",
    ]) {
      expect(json).not.toContain(value)
    }
    for (const key of ["user", "request", "server_name", "extra", "contexts"]) {
      expect(event).not.toHaveProperty(key)
    }
  })
})

describe("envelope", () => {
  test("frames header, item and payload with byte length", () => {
    const event = errorEvent(
      { ...record, message: "gagal — ü" },
      {
        release: "abc123",
        environment: "production",
        service: "web",
        root: ROOT,
      },
      0,
    )
    if (!event) throw new Error("no event")
    const body = envelope(event, new Date("2026-10-21T00:00:00Z"))
    const [header, item, payload, rest] = body.split("\n")
    expect(rest).toBe("")
    expect(JSON.parse(header ?? "")).toEqual({
      event_id: event.event_id,
      sent_at: "2026-10-21T00:00:00.000Z",
    })
    expect(JSON.parse(item ?? "")).toEqual({
      type: "event",
      content_type: "application/json",
      length: Buffer.byteLength(payload ?? "", "utf8"),
    })
    expect(Buffer.byteLength(payload ?? "")).toBeGreaterThan(
      (payload ?? "").length,
    )
    expect(JSON.parse(payload ?? "")).toEqual(event)
  })
})

describe("createErrorReporter", () => {
  test("posts an envelope with the DSN key", async () => {
    const { report, calls } = reporter(() => new Response("{}"))
    report.report(record)
    await report.flush()
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe("http://glitchtip:8000/api/1/envelope/")
    expect(calls[0]?.init.method).toBe("POST")
    // API10: never follow redirects
    expect(calls[0]?.init.redirect).toBe("error")
    const headers = new Headers(calls[0]?.init.headers)
    expect(headers.get("content-type")).toBe("application/x-sentry-envelope")
    expect(headers.get("x-sentry-auth")).toBe(
      `Sentry sentry_version=7, sentry_client=sadar-bersuara/1, sentry_key=${KEY}`,
    )
    expect(String(calls[0]?.init.body)).toContain('"type":"event"')
  })

  test("warn lines are not errors", async () => {
    const { report, calls } = reporter(() => new Response("{}"))
    report.report({ ...record, level: "warn" })
    await report.flush()
    expect(calls).toHaveLength(0)
  })

  test("failures reach the log by default", async () => {
    const out = spyOn(console, "log").mockImplementation(() => {})
    const report = createErrorReporter({
      dsn: DSN,
      environment: "production",
      service: "web",
      root: ROOT,
      fetch: async () => new Response("", { status: 503 }),
    })
    report.report(record)
    await report.flush()
    const lines = out.mock.calls.map((call) => String(call[0]))
    out.mockRestore()
    expect(lines).toEqual([
      expect.stringContaining('"msg":"error report failed","status":503'),
    ])
  })

  test("ignores lines without an error", async () => {
    const { report, calls } = reporter(() => new Response("{}"))
    report.report({ msg: "client error", status: 400 })
    await report.flush()
    expect(calls).toHaveLength(0)
  })

  test("429 stops sending until Retry-After", async () => {
    let clock = 0
    const { report, calls } = reporter(
      () =>
        new Response("", { status: 429, headers: { "Retry-After": "120" } }),
      { now: () => clock },
    )
    report.report(record)
    await report.flush()
    clock = 119_000
    report.report(record)
    await report.flush()
    expect(calls).toHaveLength(1)
    clock = 120_001
    report.report(record)
    await report.flush()
    expect(calls).toHaveLength(2)
  })

  test("429 without Retry-After waits 60 s", async () => {
    let clock = 0
    const { report, calls } = reporter(
      () => new Response("", { status: 429 }),
      { now: () => clock },
    )
    report.report(record)
    await report.flush()
    clock = 59_000
    report.report(record)
    await report.flush()
    expect(calls).toHaveLength(1)
    clock = 60_001
    report.report(record)
    await report.flush()
    expect(calls).toHaveLength(2)
  })

  test("other failures drop the event, no retry", async () => {
    let clock = 0
    const { report, calls, logs } = reporter(
      () => new Response("", { status: 500 }),
      { now: () => clock },
    )
    report.report(record)
    report.report(record)
    await report.flush()
    expect(calls).toHaveLength(2)
    // Throttled to one line
    expect(logs).toEqual([{ msg: "error report failed", status: 500 }])
    clock = 61_000
    report.report(record)
    await report.flush()
    expect(logs).toHaveLength(2)
  })

  test("Given a 429 whose body cannot be cancelled, then sending pauses until Retry-After and resumes after it", async () => {
    let clock = 0
    const stuck = () =>
      new ReadableStream<Uint8Array>({
        cancel() {
          throw new Error("socket gone")
        },
      })
    const { report, calls, logs } = reporter(
      () =>
        new Response(stuck(), {
          status: 429,
          headers: { "Retry-After": "120" },
        }),
      { now: () => clock },
    )
    report.report(record)
    await report.flush()
    expect(logs).toEqual([{ msg: "error report failed", status: 429 }])
    clock = 119_000
    report.report(record)
    await report.flush()
    expect(calls).toHaveLength(1)
    clock = 120_001
    report.report(record)
    await report.flush()
    expect(calls).toHaveLength(2)
  })

  test("never throws, rejected fetch is dropped", async () => {
    const { report, logs } = reporter(() => Promise.reject(new Error("down")))
    expect(() => report.report(record)).not.toThrow()
    await report.flush()
    expect(logs).toEqual([{ msg: "error report failed", status: 0 }])
  })

  test("bounded in flight, slow sends time out", async () => {
    const calls: string[] = []
    const hanging = async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      calls.push(String(input))
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new Error("abort")),
        )
      })
    }
    const report = createErrorReporter({
      dsn: DSN,
      environment: "production",
      service: "web",
      root: ROOT,
      fetch: hanging,
      log: () => {},
      maxInFlight: 2,
      timeoutMs: 50,
    })
    for (let i = 0; i < 5; i++) report.report(record)
    expect(calls).toHaveLength(2)
    await report.flush()
    report.report(record)
    expect(calls).toHaveLength(3)
    await report.flush()
  })
})

describe("errorReporterFromEnv", () => {
  test("off unless ERROR_REPORTING is true", () => {
    expect(errorReporterFromEnv({}, "web")).toBeUndefined()
    expect(
      errorReporterFromEnv(
        { ERROR_REPORTING: "false", GLITCHTIP_DSN: `http://${KEY}@g/1` },
        "web",
      ),
    ).toBeUndefined()
  })

  test("on needs a valid DSN", () => {
    expect(() =>
      errorReporterFromEnv({ ERROR_REPORTING: "true" }, "web"),
    ).toThrow("GLITCHTIP_DSN is not set")
    expect(() =>
      errorReporterFromEnv(
        { ERROR_REPORTING: "true", GLITCHTIP_DSN: "http://g/1" },
        "web",
      ),
    ).toThrow("GLITCHTIP_DSN")
    expect(
      errorReporterFromEnv(
        { ERROR_REPORTING: "true", GLITCHTIP_DSN: `http://${KEY}@g/1` },
        "web",
      ),
    ).toBeDefined()
  })
})
