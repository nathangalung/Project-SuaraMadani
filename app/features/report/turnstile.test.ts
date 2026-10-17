import { describe, expect, test } from "bun:test"
import { m } from "~/paraglide/messages.js"
import { captchaWait } from "./turnstile"

describe("captchaWait", () => {
  test("a check that cannot load is not called pending", () => {
    expect(captchaWait(false)).toBe(m.error_captcha_pending())
    expect(captchaWait(true)).toBe(m.error_captcha_unavailable())
    expect(captchaWait(true)).toContain(m.security_check_retry())
  })
})
