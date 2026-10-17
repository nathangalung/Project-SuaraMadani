import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { migrate } from "../../../db/migrate.ts"
import { insertRegions, superuserPool, testUrl } from "../../../db/testing.ts"
import { childrenOf, parseRegionFile } from "./regions.server.ts"

const su = superuserPool()

beforeAll(async () => {
  await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
  await insertRegions(su)
})

afterAll(async () => {
  await su.end()
})

describe("parseRegionFile", () => {
  test("accepts parent codes with .json", () => {
    expect(parseRegionFile("32.json")).toBe("32")
    expect(parseRegionFile("32.73.02.json")).toBe("32.73.02")
    expect(parseRegionFile("id.json")).toBe("id")
  })

  test("refuses villages, junk and missing suffix", () => {
    expect(parseRegionFile("32.73.02.1001.json")).toBeNull()
    expect(parseRegionFile("32")).toBeNull()
    expect(parseRegionFile("../32.json")).toBeNull()
    expect(parseRegionFile("3.json")).toBeNull()
  })
})

describe("childrenOf", () => {
  test("lists provinces for id", async () => {
    const provinces = await childrenOf("id")
    expect(provinces?.some((r) => r.code === "32")).toBe(true)
    expect(provinces?.every((r) => /^\d{2}$/.test(r.code))).toBe(true)
  })

  test("lists the children of a code", async () => {
    expect(await childrenOf("32.73")).toContainEqual({
      code: "32.73.02",
      name: "Coblong",
    })
  })

  test("unknown parent is null", async () => {
    expect(await childrenOf("99")).toBeNull()
  })
})
