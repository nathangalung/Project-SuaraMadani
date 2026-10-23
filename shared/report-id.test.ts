import { describe, expect, test } from "bun:test"
import {
  CROCKFORD_ALPHABET,
  formatReportCode,
  generateRandomCode,
  isCampusCode,
  isRandomCode,
  isReportCode,
  normalizeRandomCode,
  normalizeReportCode,
} from "./report-id.ts"

const now = new Date("2026-10-13T02:30:00Z")

function bytes(...values: number[]) {
  return (target: Uint8Array) => {
    target.set(values.slice(0, target.length))
    return target
  }
}

describe("generateRandomCode", () => {
  test("alphabet is Crockford base32", () => {
    expect(CROCKFORD_ALPHABET).toBe("0123456789ABCDEFGHJKMNPQRSTVWXYZ")
    expect(CROCKFORD_ALPHABET).toHaveLength(32)
  })

  test("campus, two-digit year, five chars", () => {
    const code = generateRandomCode("ITB", now, bytes(7, 20, 3, 26, 29))
    expect(code).toBe("ITB-26-7M3TX")
  })

  test("byte maps by low five bits", () => {
    expect(generateRandomCode("UGM", now, bytes(0, 31, 32, 255, 224))).toBe(
      "UGM-26-0Z0Z0",
    )
  })

  test("year follows Jakarta time", () => {
    const newYearWib = new Date("2026-12-31T17:30:00Z")
    expect(generateRandomCode("ITB", newYearWib, bytes(0, 0, 0, 0, 0))).toBe(
      "ITB-27-00000",
    )
  })

  test("crypto output never has I L O U", () => {
    for (let i = 0; i < 3000; i++) {
      const code = generateRandomCode("ITB", now)
      expect(isRandomCode(code)).toBe(true)
      expect(code.slice(7)).not.toMatch(/[ILOU]/)
    }
  })

  test("rejects a bad campus code", () => {
    expect(() => generateRandomCode("itb", now)).toThrow()
    expect(() => generateRandomCode("I", now)).toThrow()
    expect(() => generateRandomCode("ITB-X", now)).toThrow()
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

describe("isRandomCode", () => {
  test("strict canonical form", () => {
    expect(isRandomCode("ITB-26-7K3QX")).toBe(true)
    expect(isRandomCode("itb-26-7k3qx")).toBe(false)
    expect(isRandomCode("ITB-26-7K3QO")).toBe(false)
    expect(isRandomCode("ITB-26-7K3Q")).toBe(false)
    expect(isRandomCode("ITB-2026-7K3QX")).toBe(false)
    expect(isRandomCode("ITB267K3QX")).toBe(false)
  })
})

describe("normalizeRandomCode", () => {
  test("uppercases and restores hyphens", () => {
    expect(normalizeRandomCode(" itb-26-7k3qx ")).toBe("ITB-26-7K3QX")
    expect(normalizeRandomCode("ITB 26 7K3QX")).toBe("ITB-26-7K3QX")
    expect(normalizeRandomCode("itb267k3qx")).toBe("ITB-26-7K3QX")
  })

  test("maps O to 0 and I, L to 1 in the tail", () => {
    expect(normalizeRandomCode("ITB-26-OILQX")).toBe("ITB-26-011QX")
    expect(normalizeRandomCode("itb-26-o1lqx")).toBe("ITB-26-011QX")
  })

  test("leaves campus letters alone", () => {
    expect(normalizeRandomCode("UIO-26-00000")).toBe("UIO-26-00000")
  })

  test("rejects U and malformed input", () => {
    expect(normalizeRandomCode("ITB-26-7K3QU")).toBeNull()
    expect(normalizeRandomCode("ITB-2X-7K3QX")).toBeNull()
    expect(normalizeRandomCode("ITB-26-7K3Q")).toBeNull()
    expect(normalizeRandomCode("")).toBeNull()
    expect(normalizeRandomCode("26-7K3QX")).toBeNull()
  })

  test("is idempotent on generated codes", () => {
    for (let i = 0; i < 200; i++) {
      const code = generateRandomCode("UGM", now)
      expect(normalizeRandomCode(code)).toBe(code)
    }
  })
})

describe("report codes, LPR-year-month-number", () => {
  test("formats with padding", () => {
    expect(formatReportCode(2026, 10, 1)).toBe("LPR-2026-10-0001")
    expect(formatReportCode(2026, 3, 12345)).toBe("LPR-2026-03-12345")
  })

  test("strict canonical form", () => {
    expect(isReportCode("LPR-2026-10-0001")).toBe(true)
    expect(isReportCode("lpr-2026-10-0001")).toBe(false)
    expect(isReportCode("LPR-2026-13-0001")).toBe(false)
    expect(isReportCode("LPR-26-10-0001")).toBe(false)
    expect(isReportCode("ITB-26-7K3QX")).toBe(false)
  })

  test("normalizes typed input, refuses issue codes", () => {
    expect(normalizeReportCode(" lpr 2026 10 0001 ")).toBe("LPR-2026-10-0001")
    expect(normalizeReportCode("LPR202610 0001")).toBe("LPR-2026-10-0001")
    expect(normalizeReportCode("ISU-2026-10-0001")).toBeNull()
    expect(normalizeReportCode("LPR-2026-00-0001")).toBeNull()
    expect(normalizeReportCode("")).toBeNull()
  })
})
