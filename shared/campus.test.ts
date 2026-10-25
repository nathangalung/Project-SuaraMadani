import { describe, expect, test } from "bun:test"
import {
  invitationExpiry,
  parseCampusForm,
  parseEmail,
  removalRefusal,
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
