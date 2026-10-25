import { describe, expect, test } from "bun:test"
import {
  accountLabel,
  identifierKind,
  isReleasedEmail,
  maskEmail,
  maskPhone,
  normalizeEmail,
  normalizePhone,
  releasedEmail,
} from "./phone.ts"

describe("normalizePhone", () => {
  test("08, 62 and +62 mobile input become E.164", () => {
    for (const input of [
      "081234567890",
      "0812-3456-7890",
      "0812 3456 7890",
      "6281234567890",
      "+62 812 3456 7890",
      "(+62) 812.3456.7890",
    ]) {
      expect([input, normalizePhone(input)]).toEqual([input, "+6281234567890"])
    }
  })

  test("short and long mobile numbers at the edges", () => {
    expect(normalizePhone("0812345678")).toBe("+62812345678")
    // Typed after the +62 prefix
    expect(normalizePhone("812 3456 7890")).toBe("+6281234567890")
    expect(normalizePhone("0812345678901")).toBe("+62812345678901")
  })

  test("anything else is refused", () => {
    for (const input of [
      "",
      "   ",
      "0221234567",
      "+6221234567",
      "+1 415 555 0100",
      "+60123456789",
      "081234567",
      "08123456789012",
      "0812345678a",
      "062812345678",
      "++6281234567890",
      "08001234567",
      "+6280912345678",
    ]) {
      expect([input, normalizePhone(input)]).toEqual([input, null])
    }
  })
})

describe("normalizeEmail", () => {
  test("trims and lowercases a valid address", () => {
    expect(normalizeEmail("  Warga@Contoh.ID ")).toBe("warga@contoh.id")
  })

  test("refuses malformed input", () => {
    for (const input of ["", "warga", "warga@", "@contoh.id", "a b@c.id"]) {
      expect([input, normalizeEmail(input)]).toEqual([input, null])
    }
  })

  test("refuses the reserved .invalid domain", () => {
    expect(normalizeEmail("x@dilepas.invalid")).toBeNull()
    expect(normalizeEmail("x@contoh.test")).toBe("x@contoh.test")
  })
})

describe("released email", () => {
  test("a released address shows the number instead", () => {
    const email = releasedEmail("0190-abc")
    expect(isReleasedEmail(email)).toBe(true)
    expect(isReleasedEmail("warga@contoh.id")).toBe(false)
    expect(accountLabel({ email, phoneNumber: "+6281234567890" })).toBe(
      "+6281234567890",
    )
    expect(accountLabel({ email: "warga@contoh.id", phoneNumber: null })).toBe(
      "warga@contoh.id",
    )
  })
})

describe("identifierKind", () => {
  test("email, phone or neither", () => {
    expect(identifierKind("warga@contoh.id")).toEqual({
      kind: "email",
      value: "warga@contoh.id",
    })
    expect(identifierKind("0812 3456 7890")).toEqual({
      kind: "phone",
      value: "+6281234567890",
    })
    expect(identifierKind("warga")).toBeNull()
    expect(identifierKind("0221234567")).toBeNull()
  })
})

describe("masks", () => {
  test("phone keeps prefix and last three digits", () => {
    expect(maskPhone("+6281234567890")).toBe("+62 812•••••890")
    expect(maskPhone("+62812345678")).toBe("+62 812•••678")
  })

  test("email keeps two letters and the domain", () => {
    expect(maskEmail("warga@contoh.id")).toBe("wa•••@contoh.id")
    expect(maskEmail("ab@contoh.id")).toBe("a•••@contoh.id")
    expect(maskEmail("a@contoh.id")).toBe("a•••@contoh.id")
  })

  test("masks never contain the hidden part", () => {
    const masked = maskPhone("+6281299998888")
    expect(masked).not.toContain("9999")
    expect(maskEmail("rahasia.sekali@contoh.id")).not.toContain("sekali")
  })
})
