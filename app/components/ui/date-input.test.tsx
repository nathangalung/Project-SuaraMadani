import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { DateInput, localIsoDate, quickDates } from "./date-input"

function render(props: Partial<Parameters<typeof DateInput>[0]> = {}) {
  return renderToStaticMarkup(
    <DateInput
      id="occurredOn"
      name="occurredOn"
      label="Kapan kejadiannya?"
      min="1900-01-01"
      max="2026-10-14"
      {...props}
    />,
  )
}

describe("DateInput", () => {
  test("is one labelled native date field with bounds", () => {
    const html = render({ defaultValue: "2026-03-07" })
    expect(html).toContain('for="occurredOn"')
    expect(html).toMatch(/<input[^>]*type="date"[^>]*>/)
    const input = html.match(/<input[^>]*>/)?.[0] ?? ""
    expect(input).toContain('id="occurredOn"')
    expect(input).toContain('name="occurredOn"')
    expect(input).toContain('min="1900-01-01"')
    expect(input).toContain('max="2026-10-14"')
    expect(input).toContain('value="2026-03-07"')
    expect(html).not.toContain("<fieldset")
  })

  test("quick chips are buttons that never submit", () => {
    const html = render()
    const chips = html.match(/<button[^>]*>[^<]*<\/button>/g) ?? []
    expect(chips.map((chip) => chip.replace(/<[^>]+>/g, ""))).toEqual([
      "Hari ini",
      "Kemarin",
    ])
    for (const chip of chips) {
      expect(chip).toContain('type="button"')
      expect(chip).toContain('aria-controls="occurredOn"')
      expect(chip).toContain('aria-pressed="false"')
    }
  })

  test("chips match the input height with a visible edge", () => {
    const html = render()
    const classOf = (tag: string) =>
      (html.match(new RegExp(`<${tag}[^>]*class="([^"]*)"`))?.[1] ?? "").split(
        " ",
      )
    expect(classOf("input")).toContain("h-12")
    expect(classOf("button")).toContain("h-12")
    expect(classOf("button")).toContain("border-line")
  })

  test("fills its grid column, chips use the button radius", () => {
    const html = render()
    const classOf = (tag: string) =>
      (html.match(new RegExp(`<${tag}[^>]*class="([^"]*)"`))?.[1] ?? "").split(
        " ",
      )
    expect(classOf("input")).toContain("w-full")
    expect(classOf("input")).not.toContain("sm:w-60")
    expect(classOf("button")).toContain("rounded-[10px]")
  })

  test("error sits after the control and marks it invalid", () => {
    const html = render({
      error: "Masukkan tanggal kejadian",
      requiredMark: true,
    })
    expect(html.indexOf('id="occurredOn-error"')).toBeGreaterThan(
      html.indexOf('type="date"'),
    )
    expect(html).toMatch(/<input[^>]*aria-invalid="true"/)
    expect(html).toMatch(/<input[^>]*required=""/)
  })
})

describe("quickDates", () => {
  test("uses the device day", () => {
    expect(localIsoDate(new Date(2026, 2, 7, 23, 30))).toBe("2026-03-07")
    const [today, yesterday] = quickDates(new Date(2026, 0, 1, 8), "2026-12-31")
    expect(today?.value).toBe("2026-01-01")
    expect(yesterday?.value).toBe("2025-12-31")
  })

  test("never passes the latest allowed day", () => {
    const [today, yesterday] = quickDates(new Date(2026, 9, 15), "2026-10-14")
    expect(today?.value).toBe("2026-10-14")
    expect(yesterday?.value).toBe("2026-10-14")
  })
})
