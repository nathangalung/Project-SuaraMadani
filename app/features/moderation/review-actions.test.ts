import { describe, expect, test } from "bun:test"
import { parsePublishForm, parseReviewForm } from "./review-actions.server.ts"

function form(values: Record<string, string | string[]>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(values)) {
    for (const item of [value].flat()) data.append(key, item)
  }
  return data
}

const ISSUE_ID = "0199c2b0-1d2e-7000-8000-000000000001"

describe("parseReviewForm", () => {
  test("start review carries the status the admin saw", () => {
    expect(
      parseReviewForm(form({ intent: "start_review", from: "submitted" })),
    ).toEqual({ action: "start_review", from: "submitted" })
  })

  test("verify needs a method", () => {
    expect(
      parseReviewForm(form({ intent: "verify", from: "in_review" })),
    ).toEqual({ errors: ["verify_method"], intent: "verify" })
    expect(
      parseReviewForm(
        form({ intent: "verify", from: "in_review", method: "news_source" }),
      ),
    ).toEqual({ action: "verify", from: "in_review", method: "news_source" })
  })

  test("reporter contact verifies, contacts are readable", () => {
    expect(
      parseReviewForm(
        form({
          intent: "verify",
          from: "in_review",
          method: "reporter_contact",
        }),
      ),
    ).toEqual({
      action: "verify",
      from: "in_review",
      method: "reporter_contact",
    })
  })

  test("merge into a new issue checks title and summary", () => {
    expect(
      parseReviewForm(
        form({ intent: "merge", target: "new", title: "pendek", summary: "" }),
      ),
    ).toEqual({ errors: ["issue_title", "issue_summary"], intent: "merge" })
    expect(
      parseReviewForm(
        form({
          intent: "merge",
          target: "new",
          title: "  Atap sekolah runtuh  ",
          summary: "Beberapa laporan menyebut atap runtuh.",
        }),
      ),
    ).toEqual({
      action: "merge",
      target: {
        kind: "new",
        title: "Atap sekolah runtuh",
        summary: "Beberapa laporan menyebut atap runtuh.",
      },
    })
  })

  test("merge into an existing issue needs its id", () => {
    expect(
      parseReviewForm(form({ intent: "merge", target: "existing" })),
    ).toEqual({ errors: ["merge_issue"], intent: "merge" })
    expect(
      parseReviewForm(
        form({ intent: "merge", target: "existing", issueId: ISSUE_ID }),
      ),
    ).toEqual({
      action: "merge",
      target: { kind: "existing", issueId: ISSUE_ID },
    })
  })

  test("reject cites a standard and explains it", () => {
    expect(
      parseReviewForm(
        form({ intent: "reject", from: "in_review", reason: "standard_99" }),
      ),
    ).toEqual({ errors: ["reject_reason", "reject_text"], intent: "reject" })
    expect(
      parseReviewForm(
        form({
          intent: "reject",
          from: "in_review",
          reason: "standard_4",
          reasonText:
            "Laporan menyebut nama pegawai.\r\nKirim ulang tanpa nama.",
        }),
      ),
    ).toEqual({
      action: "reject",
      from: "in_review",
      reason: "standard_4",
      reasonText: "Laporan menyebut nama pegawai.\nKirim ulang tanpa nama.",
    })
  })

  test("unverifiable has its own reasons", () => {
    expect(
      parseReviewForm(
        form({
          intent: "mark_unverifiable",
          from: "in_review",
          reason: "standard_4",
          reasonText: "Belum ada bukti yang bisa diperiksa moderator.",
        }),
      ),
    ).toEqual({ errors: ["unverifiable_reason"], intent: "mark_unverifiable" })
  })

  test("forward needs a campus id", () => {
    expect(
      parseReviewForm(form({ intent: "forward", targetOrgId: "itb" })),
    ).toEqual({ errors: ["forward_target"], intent: "forward" })
    expect(
      parseReviewForm(form({ intent: "forward", targetOrgId: ISSUE_ID })),
    ).toEqual({ action: "forward", targetOrgId: ISSUE_ID })
  })

  test.each<Record<string, string>>([
    { intent: "delete" },
    { intent: "start_review", from: "nonsense" },
    { intent: "merge", target: "other" },
  ])("rejects %p", (values) => {
    expect(parseReviewForm(form(values))).toBeNull()
  })
})

describe("parsePublishForm", () => {
  const all = [
    "no_personal_data",
    "region_matches",
    "category_complete",
    "label_checked",
  ]

  test("every checklist item is required", () => {
    expect(
      parsePublishForm(form({ issueId: ISSUE_ID, checklist: all.slice(1) })),
    ).toEqual({ errors: ["checklist"] })
    expect(
      parsePublishForm(form({ issueId: ISSUE_ID, checklist: all })),
    ).toEqual({ issueId: ISSUE_ID })
  })

  test("a missing issue id is a bad request", () => {
    expect(parsePublishForm(form({ checklist: all }))).toBeNull()
  })
})
