import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { createRoutesStub } from "react-router"
import { NearbyList, nearbyHref } from "./nearby-issues"

function render(count: number): string {
  const issues = Array.from({ length: count }, (_, i) => ({
    code: `ISU-2026-10-000${i + 1}`,
    title: `Jalan rusak ${i + 1}`,
    reportCount: 3,
  }))
  const Stub = createRoutesStub([
    {
      path: "/",
      Component: () => (
        <NearbyList
          issues={issues}
          regency="Kota Bandung"
          href={nearbyHref("32.73")}
        />
      ),
    },
  ])
  return renderToStaticMarkup(<Stub initialEntries={["/"]} />)
}

describe("Isu Serupa di Dekat Anda", () => {
  test("lists published issues with a follow link", () => {
    const html = render(2)
    expect(html).toContain(">Isu Serupa di Dekat Anda</h2>")
    expect(html).toContain("Kota Bandung")
    expect(html).toContain('href="/isu/ISU-2026-10-0001"')
    expect(html).toContain('href="/isu/ISU-2026-10-0001#ikuti"')
    expect(html).not.toContain("wilayah=32.73")
  })

  test("three shown, the rest one link away", () => {
    const html = render(5)
    expect(html.match(/#ikuti"/g)).toHaveLength(3)
    expect(html).toContain('href="/isu?wilayah=32.73"')
  })

  test("nothing nearby, nothing shown", () => {
    expect(render(0)).toBe("")
  })
})
