import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { Select } from "./select"

describe("Select", () => {
  test("renders a native select with linked hint and error", () => {
    const html = renderToStaticMarkup(
      <Select
        id="province"
        name="province"
        label="Provinsi"
        hint="Pilih provinsi lokasi masalah"
        error="Pilih provinsi"
        defaultValue=""
      >
        <option value="">Pilih provinsi</option>
        <option value="32">Jawa Barat</option>
      </Select>,
    )
    expect(html).toMatch(/<select[^>]*id="province"/)
    expect(html).toContain('aria-describedby="province-hint province-error"')
    expect(html).toContain('aria-invalid="true"')
    expect(html).not.toContain('role="listbox"')
    expect(html).toMatch(/<svg[^>]*aria-hidden="true"/)
  })
})
