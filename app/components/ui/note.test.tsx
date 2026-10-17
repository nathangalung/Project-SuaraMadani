import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { Note } from "./note"

describe("Note", () => {
  test("tones use the tinted pairs", () => {
    const html = (tone: Parameters<typeof Note>[0]["tone"]) =>
      renderToStaticMarkup(<Note tone={tone}>Isi</Note>)
    expect(html("neutral")).toContain("bg-surface")
    expect(html("info")).toContain("bg-brand-soft")
    expect(html("success")).toContain("bg-mint-soft")
    expect(html("danger")).toContain("text-danger-ink")
  })

  test("danger icon is decorative and not a live region", () => {
    const html = renderToStaticMarkup(<Note tone="danger">Gagal</Note>)
    expect(html).toMatch(/<svg[^>]*aria-hidden="true"/)
    expect(html).not.toContain("role=")
    expect(renderToStaticMarkup(<Note>Isi</Note>)).not.toContain("<svg")
  })
})
