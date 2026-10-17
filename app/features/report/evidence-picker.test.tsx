import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { EvidencePicker, removeButtonId } from "./evidence-picker"

const photo = (name: string) =>
  new File(["x"], name, { type: "image/jpeg", lastModified: 1 })

describe("EvidencePicker", () => {
  test("each remove button has an id focus can move to", () => {
    const html = renderToStaticMarkup(
      <EvidencePicker
        files={[photo("a.jpg"), photo("b.jpg")]}
        onChange={() => {}}
        missing={[]}
      />,
    )
    expect(html).toContain(`id="${removeButtonId(0)}"`)
    expect(html).toContain(`id="${removeButtonId(1)}"`)
  })

  test("removal status region is mounted before any removal", () => {
    const html = renderToStaticMarkup(
      <EvidencePicker files={[]} onChange={() => {}} missing={[]} />,
    )
    expect(html).toMatch(/<p role="status"[^>]*><\/p>/)
  })
})

describe("EvidencePicker inputs", () => {
  const html = renderToStaticMarkup(
    <EvidencePicker
      files={[photo("a.jpg")]}
      onChange={() => {}}
      missing={[]}
    />,
  )

  test("summary link target is a labelled file input", () => {
    expect(html).toMatch(/<input[^>]*id="evidence"[^>]*>/)
    expect(html).toContain('for="evidence"')
    expect(html).toMatch(/id="evidence"[^>]*aria-describedby="evidence-hint"/)
  })

  test("touch devices get a camera input", () => {
    expect(html).toMatch(
      /<input[^>]*id="evidence-camera"[^>]*capture="environment"/,
    )
    expect(html).toContain('for="evidence-camera"')
  })

  test("remove button is named by the file", () => {
    expect(html).toContain('aria-label="Hapus a.jpg"')
  })

  test("accepts photos with HEIC, PDF and video", () => {
    // iOS keeps HEIC unconverted
    expect(html).toMatch(
      /id="evidence"[^>]*accept="image\/\*,application\/pdf,video\/\*"|accept="image\/\*,application\/pdf,video\/\*"[^>]*id="evidence"/,
    )
  })
})

describe("EvidencePicker kinds", () => {
  test("PDF and video tiles name their kind", () => {
    const html = renderToStaticMarkup(
      <EvidencePicker
        files={[
          new File(["x"], "surat.pdf", { type: "application/pdf" }),
          new File(["x"], "rekaman.mp4", { type: "video/mp4" }),
        ]}
        onChange={() => {}}
        missing={[]}
      />,
    )
    expect(html).toContain("PDF")
    expect(html).toContain("Video")
    // No blob preview for these
    expect(html).not.toContain("<img")
  })
})

describe("EvidencePicker at the limit", () => {
  test("the summary link target still exists", () => {
    const five = ["a", "b", "c", "d", "e"].map((n) => photo(`${n}.jpg`))
    const html = renderToStaticMarkup(
      <EvidencePicker
        files={five}
        onChange={() => {}}
        missing={[]}
        error="Paling banyak 5 foto"
      />,
    )
    expect(html).not.toContain('type="file"')
    expect(html).toMatch(/id="evidence"[^>]*tabindex="-1"/)
    expect(html).toContain('id="evidence-error"')
  })
})
