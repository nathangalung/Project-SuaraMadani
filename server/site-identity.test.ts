import { describe, expect, test } from "bun:test"
import { creditLine, siteIdentity } from "./site-identity.server.ts"

const base = { name: "KM ITB", campusName: "Institut Teknologi Bandung" }

describe("siteIdentity", () => {
  test("keeps what the org filled in", () => {
    expect(
      siteIdentity({
        ...base,
        contactEmail: "kontak@km.contoh.id",
        settings: {
          alliance: " Aliansi Kampus ",
          legalNumber: "AHU-0000000.AH.01.07.TAHUN 2026",
          statusUrl: "https://status.contoh.id",
        },
      }),
    ).toEqual({
      operator: "KM ITB",
      campus: "Institut Teknologi Bandung",
      alliance: "Aliansi Kampus",
      legalNumber: "AHU-0000000.AH.01.07.TAHUN 2026",
      contactEmail: "kontak@km.contoh.id",
      statusHref: "https://status.contoh.id/",
    })
  })

  test("a status link that is not a URL is left out", () => {
    const facts = siteIdentity({
      ...base,
      contactEmail: null,
      settings: { statusUrl: "status.contoh.id" },
    })
    expect(facts.statusHref).toBeUndefined()
  })

  test("drops unsafe or malformed values", () => {
    const facts = siteIdentity({
      ...base,
      contactEmail: "bukan email",
      settings: {
        alliance: "",
        legalNumber: "x".repeat(121),
        statusUrl: "javascript:alert(1)",
      },
    })
    expect(facts.alliance).toBeUndefined()
    expect(facts.legalNumber).toBeUndefined()
    expect(facts.contactEmail).toBeUndefined()
    expect(facts.statusHref).toBeUndefined()
  })

  test("rejects plain http and non-strings", () => {
    const facts = siteIdentity({
      ...base,
      contactEmail: null,
      settings: { statusUrl: "http://status.contoh.id" },
    })
    expect(facts.statusHref).toBeUndefined()
    const odd = siteIdentity({
      ...base,
      settings: { alliance: 5 } as unknown as { alliance: string },
    })
    expect(odd.alliance).toBeUndefined()
  })
})

describe("creditLine", () => {
  test("trims a filled credit, drops the rest", () => {
    expect(creditLine({ settings: { credit: " CSTS, KM ITB " } })).toBe(
      "CSTS, KM ITB",
    )
    expect(creditLine({ settings: {} })).toBeUndefined()
    expect(
      creditLine({ settings: { credit: "x".repeat(121) } }),
    ).toBeUndefined()
    const odd = { credit: 1 } as unknown as { credit: string }
    expect(creditLine({ settings: odd })).toBeUndefined()
  })
})
