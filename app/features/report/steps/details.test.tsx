import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { createRoutesStub, Outlet } from "react-router"
import { m } from "~/paraglide/messages.js"
import { latestIsoDate } from "../../../../shared/format.ts"
import type { DetailsAnswer, Draft } from "../draft"
import { DetailsStep } from "./details"

const ID = "6f1c2b9e-0d4a-4c3b-9a8e-2f5d7c1b3a90"

function render(details: DetailsAnswer = {}) {
  const draft: Draft = { submissionId: ID, details }
  const Stub = createRoutesStub([
    {
      path: "/lapor",
      Component: () => <Outlet context={{ paused: false }} />,
      children: [
        { path: "kejadian", Component: () => <DetailsStep draft={draft} /> },
      ],
    },
  ])
  return renderToStaticMarkup(<Stub initialEntries={["/lapor/kejadian"]} />)
}

const BANNER = "Hubungi 112"
const regions = (html: string) => html.match(/<div role="status"/g)?.length ?? 0

describe("112 banner", () => {
  test("urgency Darurat shows it right after the urgency question", () => {
    const html = render({ urgency: "emergency" })
    const lastUrgency = html.lastIndexOf('name="urgency"')
    expect(html.indexOf(BANNER)).toBeGreaterThan(lastUrgency)
    expect(html.indexOf(BANNER)).toBe(html.lastIndexOf(BANNER))
  })

  test("Kebencanaan shows it right after the category question", () => {
    const html = render({ categoryId: "bencana", urgency: "emergency" })
    const banner = html.indexOf(BANNER)
    expect(banner).toBeGreaterThan(html.lastIndexOf('name="categoryId"'))
    expect(banner).toBeLessThan(html.indexOf('id="subcategoryId"'))
    expect(banner).toBe(html.lastIndexOf(BANNER))
  })

  test("live regions exist before the banner text appears", () => {
    const html = render()
    expect(html).not.toContain(BANNER)
    expect(regions(html)).toBe(2)
    expect(regions(render({ urgency: "emergency" }))).toBe(2)
  })
})

describe("details questions", () => {
  test("agency suggests names through a native datalist", () => {
    const html = render()
    expect(html).toMatch(/<input[^>]*id="agency"[^>]*list="agency-options"/)
    expect(html).toMatch(
      /<datalist id="agency-options">(<option value="[^"]+"><\/option>){10,}/,
    )
    expect(html).toContain('<option value="Dinas Pendidikan"></option>')
  })

  test("categories are radios with a one-line description", () => {
    const html = render()
    expect(html).toMatch(/<input[^>]*type="radio"[^>]*name="categoryId"/)
    expect(html).toContain(m.category_bencana_hint())
    expect(html).toContain(m.details_urgency_hint())
  })

  test("long text is not cut silently and limits are stated", () => {
    const html = render()
    expect(html).not.toMatch(/maxlength/i)
    expect(html).toContain(m.details_title_hint({ min: 10, max: 120 }))
    expect(html).toContain(m.details_story_hint({ min: 40, max: 5000 }))
  })

  test("locked subcategory says to pick a category", () => {
    const locked = render()
    expect(locked).toMatch(/<select[^>]*id="subcategoryId"[^>]*disabled=""/)
    expect(locked).toContain(m.details_choose_category_first())
    const open = render({ categoryId: "bencana" })
    expect(open).not.toContain(m.details_choose_category_first())
  })

  test("agency example names no campus city", () => {
    expect(render()).not.toContain("Bandung")
  })
})

describe("urgency layout", () => {
  test("one even column on phones, a row above", () => {
    const html = render()
    const urgency = html.indexOf('name="urgency"')
    const options = html.lastIndexOf('<div class="mt-2', urgency)
    expect(html.slice(options, urgency)).toContain(
      "grid gap-y-1 sm:flex sm:flex-wrap sm:gap-x-6",
    )
  })
})

describe("occurred date", () => {
  test("is a native date field capped at the latest day", () => {
    const html = render({ occurredOn: "2026-10-01" })
    const input = html.match(/<input[^>]*type="date"[^>]*>/)?.[0] ?? ""
    expect(input).toContain('id="occurredOn"')
    expect(input).toContain('value="2026-10-01"')
    expect(input).toContain(`max="${latestIsoDate(new Date())}"`)
    expect(input).toContain('min="1900-01-01"')
    expect(html).not.toContain("occurredOn-day")
  })

  test("required questions carry the mark, agency stays optional", () => {
    const html = render()
    expect(html.match(/>\*<\/span>/g)?.length).toBe(6)
    expect(html).toContain(m.field_optional())
  })
})
