import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { PROVINCE_SHAPES, provinceSprite } from "./region-map.server.ts"

describe("province sprite", () => {
  test("committed provinces.svg matches the topology", () => {
    const file = readFileSync(join(import.meta.dir, "provinces.svg"), "utf8")
    // bun -e writes provinceSprite() there
    expect(file).toBe(provinceSprite())
    expect(PROVINCE_SHAPES).toHaveLength(38)
    expect(file).toContain("OpenStreetMap contributors, ODbL")
  })
})
