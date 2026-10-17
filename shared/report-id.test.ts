import { describe, expect, test } from "bun:test"
import {
  CROCKFORD_ALPHABET,
  generateReportCode,
  isCampusCode,
  isReportCode,
  normalizeReportCode,
} from "./report-id.ts"

const now = new Date("2026-10-13T02:30:00Z")

function bytes(...values: number[]) {
  return (target: Uint8Array) => {
    target.set(values.slice(0, target.length))
    return target
  }
}

describe("generateReportCode", () => {
  test("alphabet is Crockford base32", () => {
    expect(CROCKFORD_ALPHABET).toBe("0123456789ABCDEFGHJKMNPQRSTVWXYZ")
    expect(CROCKFORD_ALPHABET).toHaveLength(32)
  })

  test("campus, two-digit year, five chars", () => {
    const code = generateReportCode("ITB", now, bytes(7, 20, 3, 26, 29))
    expect(code).toBe("ITB-26-7M3TX")
  })

  test("byte maps by low five bits", () => {
    expect(generateReportCode("UGM", now, bytes(0, 31, 32, 255, 224))).toBe(
      "UGM-26-0Z0Z0",
    )
  })

  test("year follows Jakarta time", () => {
    const newYearWib = new Date("2026-12-31T17:30:00Z")
    expect(generateReportCode("ITB", newYearWib, bytes(0, 0, 0, 0, 0))).toBe(
      "ITB-27-00000",
    )
  })

  test("crypto output never has I L O U", () => {
    for (let i = 0; i < 3000; i++) {
      const code = generateReportCode("ITB", now)
      expect(isReportCode(code)).toBe(true)
      expect(code.slice(7)).not.toMatch(/[ILOU]/)
    }
  })

  test("rejects a bad campus code", () => {
    expect(() => generateReportCode("itb", now)).toThrow()
    expect(() => generateReportCode("I", now)).toThrow()
    expect(() => generateReportCode("ITB-X", now)).toThrow()
  })
})

describe("campus code", () => {
  test("uppercase letters then letters or digits", () => {
    expect(isCampusCode("ITB")).toBe(true)
    expect(isCampusCode("UI")).toBe(true)
    expect(isCampusCode("UNPAD2")).toBe(true)
    expect(isCampusCode("2ITB")).toBe(false)
    expect(isCampusCode("ABCDEFGHIJK")).toBe(false)
  })
})

describe("isReportCode", () => {
  test("strict canonical form", () => {
    expect(isReportCode("ITB-26-7K3QX")).toBe(true)
    expect(isReportCode("itb-26-7k3qx")).toBe(false)
    expect(isReportCode("ITB-26-7K3QO")).toBe(false)
    expect(isReportCode("ITB-26-7K3Q")).toBe(false)
    expect(isReportCode("ITB-2026-7K3QX")).toBe(false)
    expect(isReportCode("ITB267K3QX")).toBe(false)
  })
})

describe("normalizeReportCode", () => {
  test("uppercases and restores hyphens", () => {
    expect(normalizeReportCode(" itb-26-7k3qx ")).toBe("ITB-26-7K3QX")
    expect(normalizeReportCode("ITB 26 7K3QX")).toBe("ITB-26-7K3QX")
    expect(normalizeReportCode("itb267k3qx")).toBe("ITB-26-7K3QX")
  })

  test("maps O to 0 and I, L to 1 in the tail", () => {
    expect(normalizeReportCode("ITB-26-OILQX")).toBe("ITB-26-011QX")
    expect(normalizeReportCode("itb-26-o1lqx")).toBe("ITB-26-011QX")
  })

  test("leaves campus letters alone", () => {
    expect(normalizeReportCode("UIO-26-00000")).toBe("UIO-26-00000")
  })

  test("rejects U and malformed input", () => {
    expect(normalizeReportCode("ITB-26-7K3QU")).toBeNull()
    expect(normalizeReportCode("ITB-2X-7K3QX")).toBeNull()
    expect(normalizeReportCode("ITB-26-7K3Q")).toBeNull()
    expect(normalizeReportCode("")).toBeNull()
    expect(normalizeReportCode("26-7K3QX")).toBeNull()
  })

  test("is idempotent on generated codes", () => {
    for (let i = 0; i < 200; i++) {
      const code = generateReportCode("UGM", now)
      expect(normalizeReportCode(code)).toBe(code)
    }
  })
})
