import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { DrizzleQueryError } from "drizzle-orm/errors"
import {
  errorRecord,
  type LogRecord,
  setErrorReporter,
  writeError,
  writeLog,
} from "./log.ts"

const PHONE = "+6281299998888"

// Shape of pg DatabaseError
function pgCause(): Error {
  return Object.assign(new Error("violates check constraint"), {
    severity: "ERROR",
    code: "23514",
    constraint: "report_contacts_method_check",
    table: "report_contacts",
    routine: "ExecConstraints",
    detail: `Failing row contains (${PHONE}, bogus).`,
  })
}

describe("errorRecord", () => {
  test("a failed query keeps codes, never values or SQL", () => {
    const error = new DrizzleQueryError(
      'insert into "report_contacts" ("phone") values ($1)',
      ["org", PHONE],
      pgCause(),
    )
    const record = errorRecord(error)
    const line = JSON.stringify(record)
    expect(line).not.toContain(PHONE)
    expect(line).not.toContain("insert into")
    expect(record).toEqual({
      error: "Error",
      code: "23514",
      constraint: "report_contacts_method_check",
      table: "report_contacts",
      routine: "ExecConstraints",
    })
  })

  test("a bare pg error is treated the same", () => {
    const line = JSON.stringify(errorRecord(pgCause()))
    expect(line).not.toContain(PHONE)
    expect(line).toContain("23514")
  })

  test("other errors keep message and stack", () => {
    const record = errorRecord(new TypeError("boom"))
    expect(record.error).toBe("TypeError")
    expect(record.message).toBe("boom")
    expect(String(record.stack)).toContain("boom")
  })

  test("messages and stacks lose contact data", () => {
    // OWASP A09: local logs too
    const record = errorRecord(
      new Error(`no user ani@contoh.id or ${PHONE} at /isu?cari=rahasia`),
    )
    const line = JSON.stringify(record)
    for (const secret of ["ani@contoh.id", PHONE, "rahasia"]) {
      expect(line).not.toContain(secret)
    }
    expect(record.message).toBe("no user [email] or [number] at /isu?[query]")
    expect(String(record.stack)).toContain("log.test.ts")
  })

  test("non-errors log only their type", () => {
    expect(errorRecord({ phone: PHONE })).toEqual({ error: "object" })
  })
})

describe("writeError", () => {
  afterEach(() => setErrorReporter(undefined))

  test("lines carry level error", () => {
    const spy = spyOn(console, "error").mockImplementation(() => {})
    writeError({ msg: "server error", error: "TypeError" })
    const line = JSON.parse(String(spy.mock.calls[0]?.[0]))
    spy.mockRestore()
    expect(line).toMatchObject({ level: "error", msg: "server error" })
  })

  test("errors reach the reporter, logs do not", () => {
    const seen: LogRecord[] = []
    setErrorReporter({ report: (record) => seen.push(record) })
    const err = spyOn(console, "error").mockImplementation(() => {})
    const out = spyOn(console, "log").mockImplementation(() => {})
    writeError({ msg: "server error", error: "TypeError" })
    writeLog({ msg: "request", status: 200 })
    err.mockRestore()
    out.mockRestore()
    expect(seen).toEqual([{ msg: "server error", error: "TypeError" }])
  })

  test("a bundled copy reaches the reporter", async () => {
    // SSR bundle inlines a copy
    const specifier = "./log.ts?bundle"
    const copy: typeof import("./log.ts") = await import(specifier)
    const seen: LogRecord[] = []
    setErrorReporter({ report: (record) => seen.push(record) })
    const err = spyOn(console, "error").mockImplementation(() => {})
    copy.writeError({ msg: "server error", error: "Error" })
    err.mockRestore()
    expect(seen).toEqual([{ msg: "server error", error: "Error" }])
  })

  test("a throwing reporter never breaks logging", () => {
    setErrorReporter({
      report: () => {
        throw new Error("reporter down")
      },
    })
    const err = spyOn(console, "error").mockImplementation(() => {})
    expect(() => writeError({ msg: "x", error: "Error" })).not.toThrow()
    err.mockRestore()
  })
})
