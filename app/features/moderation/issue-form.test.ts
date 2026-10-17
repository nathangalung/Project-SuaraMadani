import { describe, expect, test } from "bun:test"
import { parseIssueForm } from "./issue-form.ts"

const TODAY = "2026-10-15"

function form(values: Record<string, string>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(values)) data.set(key, value)
  return data
}

const SEEN = {
  advocacy: "monitoring",
  government: "awaiting_response",
  version: "3",
}

describe("parseIssueForm", () => {
  test("refer needs agency, channel and a deadline after sending", () => {
    expect(
      parseIssueForm(
        form({
          ...SEEN,
          intent: "refer",
          agency: "  Dinas Pendidikan Kota Bandung ",
          channel: "agency_service",
          ticket: "",
          sentOn: "2026-10-14",
          deadlineOn: "2026-10-28",
        }),
        TODAY,
      ),
    ).toEqual({
      action: "refer",
      seen: {
        advocacy: "monitoring",
        government: "awaiting_response",
        version: 3,
      },
      referral: {
        agency: "Dinas Pendidikan Kota Bandung",
        channel: "agency_service",
        ticket: null,
        sentOn: "2026-10-14",
        deadlineOn: "2026-10-28",
      },
    })
    expect(
      parseIssueForm(
        form({
          ...SEEN,
          intent: "refer",
          agency: "Di",
          channel: "ombudsman",
          sentOn: "2026-10-16",
          deadlineOn: "2026-10-01",
        }),
        TODAY,
      ),
    ).toEqual({
      action: "refer",
      errors: ["agency", "channel", "sent_on", "deadline_on"],
    })
  })

  test("escalation may leave the deadline empty", () => {
    const parsed = parseIssueForm(
      form({
        advocacy: "referred",
        government: "awaiting_response",
        version: "4",
        intent: "escalate",
        agency: "Ombudsman RI Perwakilan Jawa Barat",
        channel: "ombudsman",
        sentOn: "2026-10-10",
        deadlineOn: "",
      }),
      TODAY,
    )
    expect(parsed).toMatchObject({
      action: "escalate",
      referral: { channel: "ombudsman", deadlineOn: null },
    })
  })

  test("a response needs full text and an http source", () => {
    expect(
      parseIssueForm(
        form({
          ...SEEN,
          intent: "record_response",
          responseAgency: "Dinas Pendidikan",
          body: "Terlalu pendek",
          respondedOn: TODAY,
          sourceUrl: "javascript:alert(1)",
        }),
        TODAY,
      ),
    ).toEqual({
      action: "record_response",
      errors: ["response_body", "source_url"],
    })
    expect(
      parseIssueForm(
        form({
          ...SEEN,
          intent: "record_response",
          responseAgency: "Dinas Pendidikan",
          body: "Perbaikan dijadwalkan bulan depan.\r\nAnggaran sudah ada.",
          respondedOn: TODAY,
          sourceUrl: "https://contoh.go.id/a",
        }),
        TODAY,
      ),
    ).toMatchObject({
      response: {
        body: "Perbaikan dijadwalkan bulan depan.\nAnggaran sudah ada.",
      },
    })
  })

  test("closing needs a public reason, others do not", () => {
    expect(
      parseIssueForm(form({ ...SEEN, intent: "close", note: "" }), TODAY),
    ).toEqual({ action: "close", errors: ["note"] })
    expect(
      parseIssueForm(
        form({ ...SEEN, intent: "mark_in_progress", note: "" }),
        TODAY,
      ),
    ).toMatchObject({ action: "mark_in_progress", note: null })
  })

  test("tampered state or intent is a bad request", () => {
    expect(parseIssueForm(form({ ...SEEN, intent: "fly" }), TODAY)).toBeNull()
    expect(
      parseIssueForm(
        form({
          ...SEEN,
          version: "x",
          intent: "close",
          note: "Alasan cukup panjang.",
        }),
        TODAY,
      ),
    ).toBeNull()
    expect(
      parseIssueForm(
        form({
          ...SEEN,
          government: "done",
          intent: "close",
          note: "Alasan cukup panjang.",
        }),
        TODAY,
      ),
    ).toBeNull()
  })
})
