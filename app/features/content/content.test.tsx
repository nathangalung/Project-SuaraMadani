import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { MemoryRouter } from "react-router"
import { PolicyPage } from "./policy-page"
import { updatedOn } from "./prose"

describe("policy page", () => {
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <PolicyPage
        title="Kebijakan Privasi"
        lead="Ringkasan"
        updated="2026-10-14"
        sections={[
          { id: "data", title: "Data", body: <p>a</p> },
          { id: "hak", title: "Hak Anda", body: <p>b</p> },
        ]}
      />
    </MemoryRouter>,
  )

  test("every section has an anchor in the contents", () => {
    for (const id of ["data", "hak"]) {
      expect(html).toContain(`href="#${id}"`)
      expect(html).toContain(`id="${id}"`)
    }
    expect(html).toMatch(/<h1[^>]*>Kebijakan Privasi<\/h1>/)
    expect(html).toContain("Terakhir diperbarui 14 Oktober 2026")
  })

  test("ends with one next step", () => {
    const main = html.slice(html.indexOf('id="hak"'))
    expect(main.match(/<a /g)).toHaveLength(1)
    expect(main).toMatch(/href="\/lapor"[^>]*>Buat laporan<\/a>/)
  })

  test("a fixed date keeps its day in any server zone", () => {
    const zone = process.env.TZ
    try {
      // Extremes catch local-time parsing
      for (const tz of ["Pacific/Kiritimati", "Pacific/Pago_Pago"]) {
        process.env.TZ = tz
        expect([tz, updatedOn("2026-01-01")]).toEqual([tz, "1 Januari 2026"])
      }
    } finally {
      if (zone === undefined) delete process.env.TZ
      else process.env.TZ = zone
    }
  })
})
