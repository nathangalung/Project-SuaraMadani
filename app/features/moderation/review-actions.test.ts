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
  const CHECKLIST = [
    "no_personal_data",
    "region_matches",
    "category_complete",
    "label_checked",
  ]
  const NEW = {
    target: "new",
    title: "Jalan desa rusak sejak banjir",
    summary: "Warga melaporkan jalan desa rusak.",
  }

  test("no review step, decide from Terkirim", () => {
    expect(
      parseReviewForm(form({ intent: "start_review", from: "submitted" })),
    ).toBeNull()
    expect(
      parseReviewForm(
        form({
          intent: "verify",
          from: "submitted",
          method: "document",
          target: "existing",
          issueId: ISSUE_ID,
        }),
      ),
    ).toEqual({
      action: "verify",
      from: "submitted",
      method: "document",
      target: { kind: "existing", issueId: ISSUE_ID },
    })
  })

  test("verify needs a method and an issue", () => {
    expect(
      parseReviewForm(form({ intent: "verify", from: "submitted" })),
    ).toBeNull()
    expect(
      parseReviewForm(
        form({ intent: "verify", from: "submitted", target: "existing" }),
      ),
    ).toEqual({ errors: ["verify_method", "merge_issue"], intent: "verify" })
  })

  test("a new issue publishes, so the checklist is required", () => {
    expect(
      parseReviewForm(
        form({
          intent: "verify",
          from: "submitted",
          method: "document",
          ...NEW,
        }),
      ),
    ).toEqual({ errors: ["checklist"], intent: "verify" })
    expect(
      parseReviewForm(
        form({
          intent: "verify",
          from: "submitted",
          method: "reporter_contact",
          checklist: CHECKLIST,
          ...NEW,
        }),
      ),
    ).toEqual({
      action: "verify",
      from: "submitted",
      method: "reporter_contact",
      target: { kind: "new", title: NEW.title, summary: NEW.summary },
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

  test("unverifiable needs only free text", () => {
    expect(
      parseReviewForm(form({ intent: "mark_unverifiable", from: "submitted" })),
    ).toEqual({ errors: ["unverifiable_text"], intent: "mark_unverifiable" })
    // Legacy code field ignored
    expect(
      parseReviewForm(
        form({
          intent: "mark_unverifiable",
          from: "submitted",
          reason: "no_evidence",
          reasonText: "Belum ada bukti.\r\nKirim foto lokasi.",
        }),
      ),
    ).toEqual({
      action: "mark_unverifiable",
      from: "submitted",
      reasonText: "Belum ada bukti.\nKirim foto lokasi.",
    })
  })

  test.each<Record<string, string>>([
    { intent: "delete" },
    // Campus forwarding removed 25 Oct
    { intent: "forward" },
    // Reject form removed
    {
      intent: "reject",
      from: "submitted",
      reason: "standard_4",
      reasonText: "Laporan menyebut nama pegawai.",
    },
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
