import { describe, expect, test } from "bun:test"
import {
  CATEGORIES,
  CATEGORY_IDS,
  categoryOf,
  isCategoryId,
  isSubcategoryId,
  needsEmergencyBanner,
  SUBCATEGORY_IDS,
  URGENCIES,
} from "./categories.ts"

describe("taxonomy", () => {
  test("three top categories", () => {
    expect(CATEGORY_IDS).toEqual(["program", "bencana", "bansos"])
  })

  test("subcategory IDs are unique and prefixed", () => {
    expect(new Set(SUBCATEGORY_IDS).size).toBe(SUBCATEGORY_IDS.length)
    for (const category of CATEGORIES) {
      for (const sub of category.subcategories) {
        expect(sub.id.startsWith(`${category.id}.`)).toBe(true)
        expect(sub.id).toMatch(/^[a-z]+\.[a-z_]+$/)
      }
    }
  })

  test("PLAN example ID exists", () => {
    expect(isSubcategoryId("bansos.ketepatan_sasaran")).toBe(true)
  })

  test("government response is not a subcategory", () => {
    expect(SUBCATEGORY_IDS.some((id) => id.includes("respons"))).toBe(false)
  })

  test("program has three subgroups covering every subcategory", () => {
    const program = CATEGORIES.find((c) => c.id === "program")
    const groups = new Set(program?.subcategories.map((s) => s.group))
    expect([...groups]).toEqual([
      "layanan_dasar",
      "infrastruktur_utilitas",
      "ekonomi_kebijakan",
    ])
  })

  test("other categories have no subgroups", () => {
    for (const category of CATEGORIES.filter((c) => c.id !== "program")) {
      for (const sub of category.subcategories) {
        expect(sub.group).toBeUndefined()
      }
    }
  })

  test("only disaster aid carries the disaster marker", () => {
    const marked = CATEGORIES.flatMap((c) => c.subcategories).filter(
      (s) => s.disasterRelated,
    )
    expect(marked.map((s) => s.id)).toEqual(["bansos.bantuan_korban_bencana"])
  })

  test("emergency needs stay under bencana", () => {
    expect(categoryOf("bencana.kebutuhan_darurat")).toBe("bencana")
  })
})

describe("lookups", () => {
  test("categoryOf maps subcategory to parent", () => {
    expect(categoryOf("program.air_bersih")).toBe("program")
    expect(categoryOf("program.unknown")).toBeUndefined()
  })

  test("guards reject unknown and cross IDs", () => {
    expect(isCategoryId("bansos")).toBe(true)
    expect(isCategoryId("bansos.ketepatan_sasaran")).toBe(false)
    expect(isSubcategoryId("bansos")).toBe(false)
    expect(isSubcategoryId("toString")).toBe(false)
    expect(isCategoryId("constructor")).toBe(false)
  })
})

describe("emergency banner", () => {
  test("urgency emergency or disaster category", () => {
    expect(URGENCIES).toContain("emergency")
    expect(needsEmergencyBanner({ urgency: "emergency" })).toBe(true)
    expect(needsEmergencyBanner({ categoryId: "bencana" })).toBe(true)
    expect(
      needsEmergencyBanner({ categoryId: "program", urgency: "high" }),
    ).toBe(false)
    expect(needsEmergencyBanner({})).toBe(false)
  })
})
