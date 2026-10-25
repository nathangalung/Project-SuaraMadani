import { describe, expect, test } from "bun:test"
import { demandPurgeUrls } from "./purge.server.ts"

describe("demandPurgeUrls", () => {
  test("covers the public data API copies", () => {
    const urls = demandPurgeUrls("itb.sadarbersuara.id", {
      code: "TUN-ITB-26-0001",
      version: 1,
      issues: ["ISU-ITB-26-0002"],
    })
    const origin = "https://itb.sadarbersuara.id"
    for (const path of [
      "/api/v1/tuntutan/TUN-ITB-26-0001",
      "/api/v1/tuntutan",
      "/api/v1/data",
      "/api/v1/data/tuntutan.csv",
      "/api/v1/data/tuntutan-wilayah.csv",
      "/api/v1/isu/ISU-ITB-26-0002",
    ]) {
      expect(urls).toContain(`${origin}${path}`)
    }
    expect(new Set(urls).size).toBe(urls.length)
  })
})
