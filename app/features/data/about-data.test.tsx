import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { m } from "~/paraglide/messages.js"
import { AboutData } from "./about-data"

const base = {
  facts: { operator: "KM ITB", campus: "ITB", url: "https://itb.example" },
  computedAt: "2026-10-16T03:00:00Z",
  nextAt: "2026-10-16T03:15:00Z",
  firstReportAt: null,
}

describe("AboutData method changes, PLAN §5.8", () => {
  test("says when nothing has changed", () => {
    const html = renderToStaticMarkup(<AboutData {...base} changes={[]} />)
    expect(html).toContain(m.data_method_changes_label())
    expect(html).toContain(m.data_method_none())
  })

  test("lists each change with its date", () => {
    const html = renderToStaticMarkup(
      <AboutData
        {...base}
        changes={[
          {
            on: "2027-01-04",
            charts: ["category"],
            text: () => "Subkategori Air Bersih dipecah dua.",
          },
        ]}
      />,
    )
    expect(html).toContain("4 Januari 2027")
    expect(html).toContain("Subkategori Air Bersih dipecah dua.")
    expect(html).not.toContain(m.data_method_none())
  })
})
