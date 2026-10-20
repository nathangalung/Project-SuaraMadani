import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { createRoutesStub, Outlet } from "react-router"
import { m } from "~/paraglide/messages.js"
import { siteTitle } from "./page-title"
import { StepFallback, StepPage } from "./step-page"

describe("StepFallback", () => {
  const Stub = createRoutesStub([{ path: "/lapor", Component: StepFallback }])
  const html = renderToStaticMarkup(<Stub initialEntries={["/lapor"]} />)

  test("server HTML has a page title", () => {
    expect(html).toContain(`<title>${m.report_title()}</title>`)
  })

  test("no-JS notice belongs to the form steps", () => {
    expect(html).toContain("<noscript>")
    expect(html).toContain(m.report_noscript())
  })

  test("without JS no loading placeholders show", () => {
    const pulses = html.match(/class="[^"]*animate-pulse[^"]*"/g) ?? []
    expect(pulses.length).toBeGreaterThan(0)
    expect(pulses.every((cls) => cls.includes("noscript:hidden"))).toBe(true)
  })
})

describe("siteTitle", () => {
  test("adds the site name when known", () => {
    expect(siteTitle("Masuk", "KM ITB")).toBe("Masuk · Sadar Bersuara · KM ITB")
    expect(siteTitle("Masuk", undefined)).toBe("Masuk")
  })
})

describe("StepPage", () => {
  function render(requiredNote?: boolean) {
    const Stub = createRoutesStub([
      {
        path: "/lapor",
        Component: () => <Outlet context={{ paused: false }} />,
        children: [
          {
            path: "bukti",
            Component: () => (
              <StepPage
                step="evidence"
                title="Bukti"
                requiredNote={requiredNote}
                errors={[]}
                onContinue={() => {}}
              >
                <p>Isi</p>
              </StepPage>
            ),
          },
        ],
      },
    ])
    return renderToStaticMarkup(<Stub initialEntries={["/lapor/bukti"]} />)
  }

  test("explains the asterisk unless a step has none", () => {
    expect(render()).toContain(m.field_required_note())
    expect(render(false)).not.toContain(m.field_required_note())
  })
})
