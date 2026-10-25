import { describe, expect, test } from "bun:test"
import { m } from "~/paraglide/messages.js"

describe("report copy says what the slice does", () => {
  test("headings are Title Case", () => {
    expect(String(m.evidence_chosen())).toBe("Berkas yang Dipilih")
  })

  test("success page promises no status email", () => {
    expect(m.success_next_body()).not.toContain("email")
  })

  test("age box is required for every sign-in", () => {
    expect(m.signin_age_hint()).not.toContain("akun baru")
    expect(m.signin_age()).toBe(m.consent_age())
  })

  test("contact hint names the account's WhatsApp number", () => {
    // Email sign-ins use it too
    expect(m.contact_hint()).not.toContain("untuk masuk")
    expect(m.contact_hint()).toContain("akun Anda")
    expect(m.contact_hint()).toContain("WhatsApp")
  })

  test("paused copy names what a reload loses", () => {
    expect(m.report_paused_body()).toContain("berkas bukti")
    expect(m.report_paused_body()).not.toContain("nomor telepon")
    expect(m.error_intake_paused()).not.toContain(", kirim")
  })

  test("quota copy matches the rolling window", () => {
    expect(m.error_quota_exceeded()).not.toContain("besok")
    expect(m.error_quota_exceeded()).toContain("24 jam setelah")
  })

  test("examples use misalnya without a colon", () => {
    expect(m.issues_search_hint()).not.toContain("misalnya:")
    expect(m.issues_short_query()).not.toMatch(/\.$/)
  })
})
