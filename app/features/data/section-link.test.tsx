import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { createRoutesStub } from "react-router"
import { SectionLink } from "./section-link"

describe("SectionLink", () => {
  test("without JS the reload lands on its section", () => {
    const Stub = createRoutesStub([
      {
        path: "/data",
        Component: () => (
          <SectionLink to="/data?lapisan=tuntutan" section="peta-isu">
            Tuntutan
          </SectionLink>
        ),
      },
    ])
    const html = renderToStaticMarkup(<Stub initialEntries={["/data"]} />)
    expect(html).toContain('href="/data?lapisan=tuntutan#peta-isu"')
  })
})
