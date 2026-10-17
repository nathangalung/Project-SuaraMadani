import { describe, expect, test } from "bun:test"
import { m } from "~/paraglide/messages.js"
import { faultText } from "./sender-panel"

describe("faultText", () => {
  test("worker fault codes read as Indonesian", () => {
    expect(faultText(null)).toBe(m.wa_fault_none())
    expect(faultText("logged_out")).toBe(m.wa_fault_logged_out())
    expect(faultText("link_timeout")).toBe(m.wa_fault_link_timeout())
    expect(faultText("disconnected:428")).toBe(
      m.wa_fault_disconnected({ code: "428" }),
    )
  })
})
