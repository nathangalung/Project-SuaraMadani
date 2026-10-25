import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { createRoutesStub } from "react-router"
import { hasPageSignIn } from "~/components/layout/header"
import { m } from "~/paraglide/messages.js"
import Track, { handle } from "./track"

type Props = Parameters<typeof Track>[0]

function render(own: unknown, emailReady = true, followed: unknown = null) {
  const props = {
    loaderData: { campus: "ITB", tenant: "KM ITB", own, emailReady, followed },
  } as unknown as Props
  const Stub = createRoutesStub([
    { path: "/lacak", Component: () => <Track {...props} /> },
  ])
  return renderToStaticMarkup(<Stub initialEntries={["/lacak"]} />)
}

describe("/lacak signed out", () => {
  test("lead assumes no account", () => {
    const html = render(null)
    expect(html).toContain(m.track_lead())
    expect(m.track_lead()).not.toContain("akun")
  })

  test("page owns the only sign-in", () => {
    expect(hasPageSignIn(handle)).toBe(true)
    expect(render(null).match(/href="\/masuk"/g)).toHaveLength(1)
  })
})

describe("/lacak signed in", () => {
  test("an unproven email hears that no mail comes", () => {
    const own = { reports: [], page: 1, pageCount: 1 }
    expect(render(own, false)).toContain(m.report_email_unverified())
    expect(render(own, true)).not.toContain(m.report_email_unverified())
  })

  test("followed items show under Yang Anda Ikuti", () => {
    const own = { reports: [], page: 1, pageCount: 1 }
    const followed = {
      issues: [
        {
          code: "ISU-2026-10-0007",
          title: "Jalan rusak di Dago",
          state: { advocacy: "referred", government: "responded" },
          updatedAt: new Date("2026-10-20T03:00:00Z"),
        },
      ],
      demands: [],
    }
    const html = render(own, true, followed)
    expect(html).toMatch(/<h2 id="yang-diikuti"[^>]*>Yang Anda Ikuti<\/h2>/)
    expect(html).toContain('href="/isu/ISU-2026-10-0007"')
    expect(html).toContain("Jalan rusak di Dago")
    // Signed out: no section
    expect(render(null)).not.toContain('id="yang-diikuti"')
  })
})
