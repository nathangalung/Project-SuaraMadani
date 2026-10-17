import { describe, expect, test } from "bun:test"
import {
  EMAIL_QUOTA,
  isUndeliverable,
  jakartaDayStart,
  NOTIFICATION_TEMPLATES,
  nextSendMorning,
  templateForReport,
} from "./notifications.ts"
import {
  ISSUE_ACTIONS,
  REPORT_ACTIONS,
  REPORT_STATUSES,
  REPORT_TRANSITIONS,
  transitionIssue,
  transitionReport,
} from "./status.ts"

describe("email quota", () => {
  test("OTP keeps a reserve inside the provider quota", () => {
    expect(EMAIL_QUOTA.providerDaily).toBe(300)
    expect(EMAIL_QUOTA.notificationCeiling).toBe(200)
    expect(EMAIL_QUOTA.notificationCeiling + EMAIL_QUOTA.otpReserve).toBe(
      EMAIL_QUOTA.providerDaily,
    )
  })

  test("the quota day starts at Jakarta midnight", () => {
    // 23:30 WIB on 13 October
    expect(jakartaDayStart(new Date("2026-10-13T16:30:00Z"))).toEqual(
      new Date("2026-10-12T17:00:00Z"),
    )
    // 00:30 WIB on 14 October
    expect(jakartaDayStart(new Date("2026-10-13T17:30:00Z"))).toEqual(
      new Date("2026-10-13T17:00:00Z"),
    )
  })

  test("deferral waits for 07:00 WIB the next day", () => {
    const morning = new Date("2026-10-14T00:00:00Z")
    // Late evening WIB
    expect(nextSendMorning(new Date("2026-10-13T16:00:00Z"))).toEqual(morning)
    // Just after midnight WIB
    expect(nextSendMorning(new Date("2026-10-12T17:05:00Z"))).toEqual(morning)
    // 06:59 WIB waits too
    expect(nextSendMorning(new Date("2026-10-12T23:59:00Z"))).toEqual(morning)
    // 08:00 WIB
    expect(nextSendMorning(new Date("2026-10-13T01:00:00Z"))).toEqual(morning)
  })

  test("deferral crosses month and year ends", () => {
    expect(nextSendMorning(new Date("2026-12-31T10:00:00Z"))).toEqual(
      new Date("2027-01-01T00:00:00Z"),
    )
  })
})

describe("templates", () => {
  test("every state machine follow-up has a template", () => {
    const names = new Set<string>(NOTIFICATION_TEMPLATES)
    for (const action of REPORT_ACTIONS) {
      for (const from of REPORT_TRANSITIONS[action].from) {
        for (const followUp of transitionReport(from, action).followUps) {
          expect(names.has(followUp.template)).toBe(true)
        }
      }
    }
    for (const action of ISSUE_ACTIONS) {
      const template = `issue_${action}`
      expect(names.has(template)).toBe(true)
    }
    // Throws only for illegal moves
    expect(
      transitionIssue(
        { advocacy: "monitoring", government: "awaiting_response" },
        "refer",
      ).followUps[0]?.template,
    ).toBe("issue_refer")
  })

  test("the receipt and publication are templates too", () => {
    expect(NOTIFICATION_TEMPLATES).toContain("report_submitted")
    expect(NOTIFICATION_TEMPLATES).toContain("issue_published")
  })

  test("report statuses map to their template", () => {
    for (const status of REPORT_STATUSES) {
      expect(templateForReport(status)).toBe(`report_${status}`)
    }
  })
})

describe("undeliverable addresses", () => {
  test("reserved names never reach the provider", () => {
    for (const address of [
      "sampel.itb.001@contoh.test",
      "a@example.com",
      "a@sub.example.org",
      "a@host.invalid",
      "a@localhost",
      "a@b.localhost",
      "a@b.example",
    ]) {
      expect(isUndeliverable(address)).toBe(true)
    }
  })

  test("real domains pass", () => {
    for (const address of [
      "warga@contoh.id",
      "a@gmail.com",
      "a@itb.ac.id",
      "a@notexample.com",
    ]) {
      expect(isUndeliverable(address)).toBe(false)
    }
  })
})
