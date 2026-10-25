import { describe, expect, test } from "bun:test"
import {
  addDays,
  ESCALATION_CHANNELS,
  isIsoDate,
  isRejectReason,
  parseSourceUrl,
  REFERRAL_CHANNELS,
  REJECT_REASONS,
  referralWait,
  UNVERIFIABLE_REASONS,
} from "./moderation.ts"

const AT = (iso: string) => new Date(iso)

describe("reason codes", () => {
  test("every content standard can be cited", () => {
    const standards = REJECT_REASONS.filter((r) => r.startsWith("standard_"))
    expect(standards).toHaveLength(13)
    expect(REJECT_REASONS).toContain("out_of_scope")
    expect(UNVERIFIABLE_REASONS.length).toBeGreaterThan(0)
  })

  test("codes fit CHECK literals", () => {
    for (const code of [
      ...REJECT_REASONS,
      ...UNVERIFIABLE_REASONS,
      ...REFERRAL_CHANNELS,
      ...ESCALATION_CHANNELS,
    ]) {
      expect(code).toMatch(/^[a-z0-9_.]+$/)
    }
  })

  test("reject reasons are told apart", () => {
    expect(isRejectReason("standard_13")).toBe(true)
    expect(isRejectReason("no_evidence")).toBe(false)
  })
})

describe("source url", () => {
  test("http and https only", () => {
    expect(parseSourceUrl(" https://contoh.go.id/berita/1 ")).toBe(
      "https://contoh.go.id/berita/1",
    )
    expect(parseSourceUrl("http://contoh.id")).toBe("http://contoh.id/")
    expect(parseSourceUrl("javascript:alert(1)")).toBeNull()
    expect(parseSourceUrl("data:text/html,x")).toBeNull()
    expect(parseSourceUrl("contoh.id")).toBeNull()
    expect(parseSourceUrl("")).toBeNull()
    expect(parseSourceUrl(`https://contoh.id/${"a".repeat(2100)}`)).toBeNull()
  })

  test("credentials in the url are refused", () => {
    expect(parseSourceUrl("https://user:pass@contoh.id")).toBeNull()
  })
})

describe("dates", () => {
  test("iso calendar days only", () => {
    expect(isIsoDate("2026-10-15")).toBe(true)
    expect(isIsoDate("2026-02-30")).toBe(false)
    expect(isIsoDate("15-10-2026")).toBe(false)
  })

  test("adds calendar days", () => {
    expect(addDays("2026-10-25", 14)).toBe("2026-11-08")
  })
})

describe("referral wait", () => {
  const referral = { sentOn: "2026-10-01", deadlineOn: "2026-10-15" }

  test("counts Jakarta days since the referral", () => {
    // 16 Oct 01:00 WIB
    expect(
      referralWait(referral, "awaiting_response", AT("2026-10-15T18:00:00Z")),
    ).toEqual({ days: 15, overdue: true })
    expect(
      referralWait(referral, "awaiting_response", AT("2026-10-15T03:00:00Z")),
    ).toEqual({ days: 14, overdue: false })
  })

  test("only while the response is awaited", () => {
    expect(
      referralWait(referral, "responded", AT("2026-10-20T03:00:00Z")),
    ).toBeNull()
  })

  test("no deadline is never overdue", () => {
    expect(
      referralWait(
        { sentOn: "2026-10-01", deadlineOn: null },
        "awaiting_response",
        AT("2026-12-01T03:00:00Z"),
      ),
    ).toEqual({ days: 61, overdue: false })
  })
})
