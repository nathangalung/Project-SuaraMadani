import { describe, expect, test } from "bun:test"
import {
  invitationExpiry,
  LOGO_MAX_BYTES,
  logoTooLarge,
  parseCampusForm,
  parseEmail,
  parseIdentityForm,
  removalRefusal,
  sniffLogo,
} from "./campus.ts"

describe("emails", () => {
  test("trimmed, lowercased, shape checked", () => {
    expect(parseEmail("  Admin@Kampus.AC.id ")).toBe("admin@kampus.ac.id")
    expect(parseEmail("bukan email")).toBeNull()
    expect(parseEmail("a@b")).toBeNull()
    expect(parseEmail(`${"a".repeat(250)}@b.id`)).toBeNull()
  })
})

describe("removal rule", () => {
  test("an admin removes another admin", () => {
    expect(removalRefusal(["a", "b"], "a", "b")).toBeNull()
  })

  test("nobody removes themself", () => {
    expect(removalRefusal(["a", "b"], "a", "a")).toBe("self")
    expect(removalRefusal(["a"], "a", "a")).toBe("self")
  })

  test("the last admin always stays", () => {
    expect(removalRefusal(["b"], "x", "b")).toBe("last_admin")
  })

  test("a non-admin target never counts", () => {
    expect(removalRefusal(["a"], "a", "e")).toBeNull()
  })
})

describe("invitations", () => {
  test("expire seven days after sending", () => {
    expect(invitationExpiry(new Date("2026-10-15T03:00:00Z"))).toEqual(
      new Date("2026-10-22T03:00:00Z"),
    )
  })
})

describe("campus form", () => {
  const valid = {
    slug: "ui",
    name: "BEM UI",
    campusName: "Universitas Indonesia",
    campusCode: "ui",
    adminEmail: "Admin@UI.ac.id",
    contactEmail: "",
  }

  test("normalises a valid campus", () => {
    expect(parseCampusForm(valid)).toEqual({
      ok: true,
      value: {
        slug: "ui",
        name: "BEM UI",
        campusName: "Universitas Indonesia",
        campusCode: "UI",
        adminEmail: "admin@ui.ac.id",
        contactEmail: null,
      },
    })
  })

  test("refuses reserved and malformed subdomains", () => {
    for (const slug of [
      "www",
      "media",
      "-ui",
      "ui-",
      "u",
      "Ui!",
      "a".repeat(33),
    ]) {
      const result = parseCampusForm({ ...valid, slug })
      expect(result.ok ? [] : result.errors).toContain("slug")
    }
  })

  test("codes follow the report code rule", () => {
    for (const campusCode of ["1UI", "U", "UNIVERSITAS1"]) {
      const result = parseCampusForm({ ...valid, campusCode })
      expect(result.ok ? [] : result.errors).toContain("campusCode")
    }
  })

  test("names every missing field", () => {
    const result = parseCampusForm({})
    expect(result.ok ? [] : result.errors).toEqual([
      "campusName",
      "name",
      "slug",
      "campusCode",
      "adminEmail",
    ])
  })
})

describe("logo sniffing", () => {
  const bytes = (...values: number[]) => new Uint8Array(values)

  test("PNG, JPEG and WebP by magic bytes", () => {
    expect(
      sniffLogo(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)),
    ).toBe("png")
    expect(sniffLogo(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("jpeg")
    expect(sniffLogo(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 "))).toBe(
      "webp",
    )
  })

  test("SVG and anything else is refused", () => {
    expect(sniffLogo(new TextEncoder().encode("<svg xmlns="))).toBeNull()
    expect(sniffLogo(bytes())).toBeNull()
  })

  test("the cap fits the form body limit", () => {
    expect(LOGO_MAX_BYTES).toBeLessThanOrEqual(100 * 1024)
  })
})

describe("identity form, PLAN §6.1", () => {
  const valid = {
    name: " KM  ITB ",
    campusName: "Institut Teknologi Bandung",
    contactEmail: "Halo@KM.itb.ac.id",
    alliance: "Aliansi Mahasiswa Indonesia",
    legalNumber: "AHU-0012345.AH.01.07.2026",
    credit: "Dibuat tim relawan KM ITB",
    officers: "Ketua: Ani Rahma\r\n\r\n  Sekretaris: Budi  \n",
  }

  test("trims, splits officers, empties become null", () => {
    expect(parseIdentityForm(valid)).toEqual({
      ok: true,
      value: {
        name: "KM ITB",
        campusName: "Institut Teknologi Bandung",
        contactEmail: "halo@km.itb.ac.id",
        alliance: "Aliansi Mahasiswa Indonesia",
        legalNumber: "AHU-0012345.AH.01.07.2026",
        credit: "Dibuat tim relawan KM ITB",
        officers: ["Ketua: Ani Rahma", "Sekretaris: Budi"],
      },
    })
    const empty = parseIdentityForm({
      ...valid,
      contactEmail: "",
      alliance: " ",
      legalNumber: "",
      credit: "",
      officers: "",
    })
    expect(empty.ok && empty.value).toMatchObject({
      contactEmail: null,
      alliance: null,
      legalNumber: null,
      credit: null,
      officers: [],
    })
  })

  test("names required, limits enforced", () => {
    const result = parseIdentityForm({
      ...valid,
      name: "K",
      contactEmail: "bukan-email",
      legalNumber: "x".repeat(81),
      officers: Array.from({ length: 21 }, (_, i) => `Pengurus ${i}`).join(
        "\n",
      ),
    })
    expect(result).toEqual({
      ok: false,
      errors: ["name", "contactEmail", "legalNumber", "officers"],
    })
  })
})

describe("logoTooLarge", () => {
  test("checks before the form body cap", () => {
    expect(logoTooLarge(undefined)).toBe(false)
    expect(logoTooLarge({ size: LOGO_MAX_BYTES })).toBe(false)
    expect(logoTooLarge({ size: LOGO_MAX_BYTES + 1 })).toBe(true)
    expect(logoTooLarge({ size: 200 * 1024 })).toBe(true)
  })
})
