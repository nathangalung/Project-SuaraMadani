import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { m } from "~/paraglide/messages.js"
import { ChartCard } from "./chart-card"
import type { MethodChange } from "./method-changes"

describe("ChartCard", () => {
  test("each table toggle names its chart", () => {
    const html = renderToStaticMarkup(
      <ChartCard title="Laporan per Bulan" table={<p>t</p>} meta="n">
        <p>chart</p>
      </ChartCard>,
    )
    const button = /<button[^>]*>(.*?)<\/button>/.exec(html)?.[1] ?? ""
    expect(button).toContain("Tabel")
    expect(button).toContain('<span class="sr-only"> Laporan per Bulan</span>')
  })

  test("a method change marks the charts it touched", () => {
    const changes: MethodChange[] = [
      {
        on: "2027-01-04",
        charts: ["category"],
        text: () => "Subkategori baru",
      },
    ]
    const card = (chart: "category" | "monthly") =>
      renderToStaticMarkup(
        <ChartCard
          title="Isu Terbit per Kategori"
          chart={chart}
          changes={changes}
          table={<p>t</p>}
          meta="n"
        >
          <p>chart</p>
        </ChartCard>,
      )
    expect(card("category")).toContain(
      m.data_method_changed({ date: "4 Januari 2027" }),
    )
    expect(card("category")).toContain('href="#metode"')
    expect(card("monthly")).not.toContain(
      m.data_method_changed({ date: "4 Januari 2027" }),
    )
  })
})
