import { describe, expect, test } from "bun:test"
import { whatsappCodeText } from "./whatsapp-text.ts"

describe("whatsappCodeText", () => {
  test("plain and short, never a link", () => {
    const text = whatsappCodeText("123456")
    expect(text).toContain("123456")
    expect(text).toContain("5 menit")
    expect(text.length).toBeLessThanOrEqual(120)
    expect(text).not.toMatch(/https?:|www\.|\.id\b|\.com\b|\*|_/)
  })
})
