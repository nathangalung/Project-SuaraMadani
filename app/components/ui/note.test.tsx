import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { Note } from "./note"

describe("Note", () => {
  test("no tone draws a box or a left bar", () => {
    for (const tone of ["neutral", "info", "success", "danger"] as const) {
      const html = renderToStaticMarkup(<Note tone={tone}>Isi</Note>)
      expect(html).not.toMatch(/border-l-|bg-[a-z-]*soft|bg-surface|p-4/)
    }
  })

  test("the icon carries the tone, text stays readable", () => {
    const html = (tone: Parameters<typeof Note>[0]["tone"]) =>
      renderToStaticMarkup(<Note tone={tone}>Isi</Note>)
    expect(html("info")).toContain("text-accent")
    expect(html("success")).toContain("text-success")
    expect(html("danger")).toContain("text-danger")
    expect(html("info")).toMatch(/^<div class="[^"]*text-ink/)
  })

  test("icons are decorative and not a live region", () => {
    const html = renderToStaticMarkup(<Note tone="danger">Gagal</Note>)
    expect(html).toMatch(/<svg[^>]*aria-hidden="true"/)
    expect(html).not.toContain("role=")
    expect(renderToStaticMarkup(<Note>Isi</Note>)).not.toContain("<svg")
  })
})
