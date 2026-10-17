import { describe, expect, test } from "bun:test"
import { DrizzleQueryError } from "drizzle-orm/errors"
import { errorRecord } from "./log.ts"

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

  test("non-errors log only their type", () => {
    expect(errorRecord({ phone: PHONE })).toEqual({ error: "object" })
  })
})
