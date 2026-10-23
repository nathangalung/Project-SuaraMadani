import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { createRoutesStub } from "react-router"
import { m } from "~/paraglide/messages.js"
import { ISSUE_SUMMARY_LENGTH, ISSUE_TITLE_LENGTH } from "./fields"
import {
  MergeForm,
  PublishForm,
  reviewErrors,
  VerifyForm,
} from "./review-forms"

function render(Form: () => React.ReactNode) {
  const Stub = createRoutesStub([{ path: "/", Component: Form }])
  return renderToStaticMarkup(<Stub initialEntries={["/"]} />)
}

describe("error summary targets", () => {
  test.each([
    [
      "verify_method",
      () => (
        <VerifyForm
          from="in_review"
          contactable
          errors={reviewErrors(["verify_method"])}
        />
      ),
    ],
    [
      "checklist",
      () => <PublishForm issueId="x" errors={reviewErrors(["checklist"])} />,
    ],
  ] as const)("%s links to the first input", (key, Form) => {
    const html = render(Form)
    const [error] = reviewErrors([key])
    const firstInput = html.match(/<input[^>]*type="(?:radio|checkbox)"[^>]*>/)
    expect(firstInput?.[0]).toContain(`id="${error?.fieldId}"`)
    expect(html).toContain(error?.message ?? "missing message")
  })

  test("verify offers all five PLAN §5.5 methods", () => {
    const html = render(() => (
      <VerifyForm from="in_review" contactable errors={[]} />
    ))
    expect(html).toContain("Kontak pelapor")
    expect(html.match(/name="method"/g)).toHaveLength(5)
  })

  test("no contact method without the reporter's consent", () => {
    const html = render(() => (
      <VerifyForm
        from="in_review"
        contactable={false}
        errors={reviewErrors(["verify_contact"])}
      />
    ))
    expect(html).not.toContain('value="reporter_contact"')
    expect(html.match(/name="method"/g)).toHaveLength(4)
    expect(html).toContain(m.manage_verify_hint_no_contact())
    expect(html).toContain(m.error_verify_contact())
  })
})

describe("merge form", () => {
  test("long text is not cut silently and limits are stated", () => {
    const html = render(() => (
      <MergeForm
        defaultTitle="Jalan rusak"
        targets={[]}
        search=""
        errors={[]}
      />
    ))
    expect(html).not.toMatch(/maxlength/i)
    expect(html).toContain(m.manage_issue_title_hint(ISSUE_TITLE_LENGTH))
    expect(html).toContain(m.manage_issue_summary_hint(ISSUE_SUMMARY_LENGTH))
  })

  test("issue select is marked invalid, no red bar", () => {
    const html = render(() => (
      <MergeForm
        defaultTitle="Jalan rusak"
        targets={[
          {
            id: "1",
            code: "ISU-2026-10-0001",
            title: "Jalan",
            sameRegency: false,
          },
        ]}
        search=""
        errors={reviewErrors(["merge_issue"])}
      />
    ))
    expect(html).toMatch(/<select[^>]*aria-invalid="true"/)
    // Only the select's own border
    const bars = [...html.matchAll(/class="([^"]*)"/g)].filter((m) =>
      (m[1] ?? "").split(" ").includes("border-danger"),
    )
    expect(bars).toEqual([])
  })

  test("targets can be searched, same regency is marked", () => {
    const html = render(() => (
      <MergeForm
        defaultTitle="Jalan rusak"
        targets={[
          {
            id: "1",
            code: "ISU-2026-10-0001",
            title: "Jalan",
            sameRegency: true,
          },
        ]}
        search="jalan"
        errors={[]}
      />
    ))
    expect(html).toMatch(/<form[^>]*method="get"[^>]*>[\s\S]*?name="cari"/)
    expect(html).toContain('value="jalan"')
    expect(html).toContain("ISU-2026-10-0001 · Jalan · kab/kota sama")
    // Search picks the existing radio
    expect(html).toMatch(/id="merge-target-existing"[^>]*checked=""/)
  })

  test("each branch sits under its radio, hidden otherwise", () => {
    const html = render(() => (
      <MergeForm
        defaultTitle="Jalan rusak"
        targets={[
          {
            id: "i1",
            code: "ISU-2026-10-0001",
            title: "Jalan",
            sameRegency: false,
          },
        ]}
        search=""
        errors={[]}
      />
    ))
    const order = [
      'id="merge-target-new"',
      'name="title"',
      'name="summary"',
      'id="merge-target-existing"',
      'name="cari"',
      'name="issueId"',
    ].map((needle) => html.indexOf(needle))
    expect(order.every((at) => at > 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    // CSS only, no JS needed
    expect(html).toMatch(
      /group-has-\[#merge-target-existing:checked\]:hidden[^>]*>[\s\S]*?name="title"/,
    )
    expect(html).toMatch(
      /group-has-\[#merge-target-new:checked\]:hidden[^>]*>[\s\S]*?name="cari"/,
    )
    // Search uses its GET form
    expect(html).toMatch(
      /name="cari"[^>]*form="merge-search"|form="merge-search"[^>]*name="cari"/,
    )
    expect(html).toMatch(
      /<form[^>]*id="merge-search"[^>]*method="get"|<form[^>]*method="get"[^>]*id="merge-search"/,
    )
  })
})
