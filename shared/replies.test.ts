import { describe, expect, test } from "bun:test"
import { checkReply, DAILY_REPLIES, REPLY_LENGTHS } from "./replies.ts"

const valid = {
  agency: "Dinas Pekerjaan Umum Kota Bandung",
  senderRole: "Kepala Bidang Jalan",
  body: "Perbaikan jalan dijadwalkan pada pekan kedua November 2026.",
  sourceUrl: "",
}

describe("right of reply form", () => {
  test("accepts a reply without a source", () => {
    expect(checkReply(valid)).toEqual({
      ok: true,
      input: {
        agency: valid.agency,
        senderRole: valid.senderRole,
        body: valid.body,
        sourceUrl: null,
      },
    })
  })

  test("keeps an http source", () => {
    const checked = checkReply({ ...valid, sourceUrl: " https://pu.go.id/a " })
    expect(checked.ok && checked.input.sourceUrl).toBe("https://pu.go.id/a")
  })

  test("names every bad field", () => {
    expect(
      checkReply({
        agency: "ab",
        senderRole: "",
        body: "terlalu pendek",
        sourceUrl: "javascript:alert(1)",
      }),
    ).toEqual({
      ok: false,
      errors: ["agency", "sender_role", "body", "source_url"],
    })
  })

  test("caps long text", () => {
    const body = "a".repeat(REPLY_LENGTHS.body.max + 1)
    expect(checkReply({ ...valid, body })).toEqual({
      ok: false,
      errors: ["body"],
    })
  })

  test("daily cap per account", () => {
    expect(DAILY_REPLIES).toBe(5)
  })
})
