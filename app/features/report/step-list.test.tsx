import { describe, expect, test } from "bun:test"
import type { ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { createRoutesStub, Outlet } from "react-router"
import { m } from "~/paraglide/messages.js"
import { REPORT_STEPS } from "../../../shared/report-fields.ts"
import { STEP_DESC_TEXT, STEP_TITLE_TEXT } from "./labels"
import { StepList, StepProgress } from "./step-list"
import { StepFallback, StepPage, stepOfHandle } from "./step-page"

describe("StepList", () => {
  const html = renderToStaticMarkup(
    <StepList current="details" done={new Set(["relation", "location"])} />,
  )

  test("one current step, marked as a step", () => {
    expect(html.match(/aria-current="step"/g)?.length).toBe(1)
    const current = html.slice(html.indexOf('aria-current="step"'))
    expect(current).toContain(m.step_details_title())
  })

  test("not clickable and not a progressbar", () => {
    expect(html).not.toContain("<a ")
    expect(html).not.toContain("<button")
    expect(html).not.toContain("progressbar")
    expect(html).toMatch(/^<ol aria-label="Tahapan laporan"/)
  })

  test("descriptions add to the title", () => {
    const words = (text: string) =>
      text.toLowerCase().match(/\p{L}{4,}/gu) ?? []
    for (const step of REPORT_STEPS) {
      const title = new Set(words(STEP_TITLE_TEXT[step]()))
      const desc = words(STEP_DESC_TEXT[step]())
      const repeated = desc.filter((word) => title.has(word)).length
      expect(repeated / desc.length).toBeLessThan(0.5)
    }
  })

  test("done and todo are spoken, current is not", () => {
    expect(html.match(/\(selesai\)/g)?.length).toBe(2)
    // Four later steps
    expect(html.match(/\(belum diisi\)/g)?.length).toBe(4)
  })
})

describe("StepProgress", () => {
  const html = renderToStaticMarkup(
    <StepProgress current="details" done={new Set(["relation"])} />,
  )

  test("caption says where the reader is", () => {
    expect(html).toContain("Langkah 3 dari 7")
  })

  test("bar is decorative, seven parts", () => {
    expect(html).toMatch(/<div aria-hidden="true"[^>]*grid-cols-7/)
    expect(html.match(/<span class="h-1.5/g)?.length).toBe(7)
    expect(html).not.toContain("role=")
  })

  test("only answered steps are ink", () => {
    const parts = html.match(/<span class="h-1.5 rounded-full [^"]*"/g) ?? []
    expect(parts.map((part) => part.split(" ").at(-1))).toEqual([
      'bg-ink"',
      'bg-ink/12"',
      'bg-brand"',
      'bg-ink/12"',
      'bg-ink/12"',
      'bg-ink/12"',
      'bg-ink/12"',
    ])
  })
})

describe("stepOfHandle", () => {
  test("reads known steps, null and junk", () => {
    expect(stepOfHandle({ reportStep: "impact" })).toBe("impact")
    expect(stepOfHandle({ reportStep: null })).toBeNull()
    expect(stepOfHandle({ reportStep: "lain" })).toBeUndefined()
    expect(stepOfHandle(undefined)).toBeUndefined()
  })
})

describe("step shell", () => {
  function render(children: () => ReactNode, handle?: unknown) {
    const Stub = createRoutesStub([
      {
        path: "/lapor",
        Component: () => <Outlet context={{ paused: false }} />,
        children: [{ path: "kejadian", Component: children, handle }],
      },
    ])
    return renderToStaticMarkup(<Stub initialEntries={["/lapor/kejadian"]} />)
  }

  test("fallback shows the question as the only h1", () => {
    const html = render(StepFallback, { reportStep: "details" })
    expect(html.match(/<h1/g)?.length).toBe(1)
    expect(html).toMatch(/<h1[^>]*>Apa yang Terjadi\?<\/h1>/)
    expect(html).toContain("Langkah 3 dari 7")
    expect(html).toContain('class="animate-pulse')
  })

  test("fallback keeps the back link and form height", () => {
    const html = render(StepFallback, { reportStep: "details" })
    const back = html.indexOf(m.report_back())
    expect(back).toBeGreaterThan(-1)
    expect(back).toBeLessThan(html.indexOf("Langkah 3 dari 7"))
    expect(html).toContain('href="/lapor/lokasi"')
    expect(html).toMatch(/class="min-h-387 [^"]*noscript:min-h-0"/)
  })

  test("back link first, progress before the question", () => {
    const html = render(() => (
      <StepPage
        step="details"
        title="Apa yang Terjadi?"
        errors={[]}
        onContinue={() => {}}
      >
        <p>Isi</p>
      </StepPage>
    ))
    const back = html.indexOf(m.report_back())
    const caption = html.indexOf("Langkah 3 dari 7")
    const h1 = html.indexOf("<h1")
    expect(back).toBeGreaterThan(-1)
    expect(back).toBeLessThan(caption)
    expect(caption).toBeLessThan(h1)
    expect(html).toMatch(/<button type="submit" class="[^"]*bg-ink/)
    // Full width on phones
    expect(html).toMatch(/<button type="submit" class="[^"]* w-full sm:w-auto/)
    // Root scroll padding suffices
    expect(html).not.toContain("scroll-mt-")
  })
})
