import { describe, expect, test } from "bun:test"
import { createOTP } from "@better-auth/utils/otp"
import { matchedStep } from "./totp-step.ts"

const secret = "abcdefghijklmnopqrstuvwxyz012345"
const now = 1_791_900_015_000
const step = Math.floor(now / 30_000)

describe("matchedStep", () => {
  test("finds the step Better Auth accepts, within one step", async () => {
    const otp = createOTP(secret)
    for (const offset of [-1, 0, 1]) {
      const code = await otp.hotp(step + offset)
      expect(matchedStep(secret, code, now)).toBe(step + offset)
    }
  })

  test("a code two steps old matches nothing", async () => {
    const code = await createOTP(secret).hotp(step - 2)
    expect(matchedStep(secret, code, now)).toBeNull()
  })

  test("a malformed code matches nothing", () => {
    expect(matchedStep(secret, "12345", now)).toBeNull()
    expect(matchedStep(secret, "", now)).toBeNull()
  })
})
