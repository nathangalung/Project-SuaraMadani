import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { m } from "~/paraglide/messages.js"
import type { ReviewReport } from "./queue.server"
import { ReportDetails } from "./report-details"

const report = {
  code: "LPR-2026-10-0001",
  relation: "self",
  otherConsent: null,
  title: "Banjir di Jalan Ganesha",
  story: "Air setinggi lutut sejak pagi.",
  categoryId: "bencana",
  subcategoryId: "bencana.banjir",
  occurredOn: "2026-10-01",
  agency: null,
  urgency: "high",
  affectedGroups: ["public"],
  affectedCount: "11-100",
  ongoing: "yes",
  contactable: false,
  provinceName: "Jawa Barat",
  regencyName: "Kota Bandung",
  districtName: "Coblong",
  villageName: null,
  createdAt: new Date("2026-10-14T03:00:00Z"),
  evidence: [],
} as unknown as ReviewReport

describe("report details", () => {
  test("category row names both levels, like step 7", () => {
    const html = renderToStaticMarkup(<ReportDetails report={report} />)
    expect(html).toContain(
      `<dt class="font-semibold">${m.review_category()}</dt><dd class="min-w-0 whitespace-pre-line">Kebencanaan: Banjir</dd>`,
    )
  })

  test("device point shows only when stored", () => {
    const html = renderToStaticMarkup(
      <ReportDetails
        report={{ ...report, point: { lat: -6.8932, lng: 107.6107 } }}
      />,
    )
    expect(html).toContain(
      `<dt class="font-semibold">${m.review_point()}</dt><dd class="min-w-0 whitespace-pre-line">-6.89320, 107.61070</dd>`,
    )
    const none = renderToStaticMarkup(<ReportDetails report={report} />)
    expect(none).not.toContain(m.review_point())
  })
})
