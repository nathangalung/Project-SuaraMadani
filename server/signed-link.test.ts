import { describe, expect, test } from "bun:test"
import {
  LINK_TTL_MS,
  linkExpiry,
  parseKeyring,
  signLink,
  verifyLink,
} from "./signed-link.ts"

const KEY_1 = Buffer.alloc(32, 1).toString("base64")
const KEY_2 = Buffer.alloc(32, 2).toString("base64")
const ORG = "0199e000-0000-7000-8000-000000000001"
const OTHER_ORG = "0199e000-0000-7000-8000-000000000002"
const REPORT = "0199e000-0000-7000-8000-0000000000aa"
const USER = "0199e000-0000-7000-8000-0000000000bb"
const ISSUED = new Date("2026-10-13T03:00:00Z")

const keyring = parseKeyring(`2:${KEY_2},1:${KEY_1}`)

function lacak(now = ISSUED) {
  return signLink(keyring, {
    purpose: "lacak",
    orgId: ORG,
    subjectId: REPORT,
    userId: USER,
    expiresAt: linkExpiry(now),
  })
}

describe("keyring", () => {
  test("the first entry signs", () => {
    expect(keyring.current).toBe(2)
    expect(lacak().startsWith("2.")).toBe(true)
  })

  test("refuses empty, malformed and short keys", () => {
    expect(() => parseKeyring(undefined)).toThrow("LACAK_LINK_KEYS")
    expect(() => parseKeyring("")).toThrow("LACAK_LINK_KEYS")
    expect(() => parseKeyring(KEY_1)).toThrow("version")
    expect(() => parseKeyring(`1:${KEY_1},1:${KEY_2}`)).toThrow("Duplicate")
    expect(() => parseKeyring("1:c2hvcnQ=")).toThrow("32 bytes")
  })
})

describe("signed links", () => {
  test("a fresh link verifies for its purpose and tenant", () => {
    expect(
      verifyLink(keyring, lacak(), {
        purpose: "lacak",
        orgId: ORG,
        now: ISSUED,
      }),
    ).toEqual({ subjectId: REPORT, userId: USER })
  })

  test("valid for 30 days, then expired", () => {
    expect(LINK_TTL_MS).toBe(30 * 86_400_000)
    const token = lacak()
    const check = (now: Date) =>
      verifyLink(keyring, token, { purpose: "lacak", orgId: ORG, now })
    expect(check(new Date(ISSUED.getTime() + LINK_TTL_MS - 1000))).not.toBe(
      null,
    )
    expect(check(new Date(ISSUED.getTime() + LINK_TTL_MS))).toBe(null)
  })

  test("another tenant or purpose is refused", () => {
    const token = lacak()
    expect(
      verifyLink(keyring, token, {
        purpose: "lacak",
        orgId: OTHER_ORG,
        now: ISSUED,
      }),
    ).toBe(null)
    expect(
      verifyLink(keyring, token, {
        purpose: "berhenti",
        orgId: ORG,
        now: ISSUED,
      }),
    ).toBe(null)
  })

  test("any tampered character is refused", () => {
    const token = lacak()
    const [version, body, sig] = token.split(".")
    const flip = (value = "") =>
      `${value.slice(0, 5)}${value[5] === "A" ? "B" : "A"}${value.slice(6)}`
    const forgedBody = Buffer.from(
      `lacak|${ORG}|${REPORT}|${USER}|9999999999`,
    ).toString("base64url")
    for (const bad of [
      `${version}.${flip(body)}.${sig}`,
      `${version}.${body}.${flip(sig)}`,
      `${version}.${forgedBody}.${sig}`,
      `1.${body}.${sig}`,
      `9.${body}.${sig}`,
      `${version}.${body}`,
      "",
      "...",
      "x".repeat(2000),
    ]) {
      expect(
        verifyLink(keyring, bad, { purpose: "lacak", orgId: ORG, now: ISSUED }),
      ).toBe(null)
    }
  })

  test("an old key still verifies until it is dropped", () => {
    const old = parseKeyring(`1:${KEY_1}`)
    const token = signLink(old, {
      purpose: "lacak",
      orgId: ORG,
      subjectId: REPORT,
      userId: USER,
      expiresAt: linkExpiry(ISSUED),
    })
    const options = { purpose: "lacak", orgId: ORG, now: ISSUED } as const
    expect(verifyLink(keyring, token, options)).not.toBe(null)
    expect(verifyLink(parseKeyring(`2:${KEY_2}`), token, options)).toBe(null)
  })
})
