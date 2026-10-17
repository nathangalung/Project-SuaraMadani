import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { createRoutesStub } from "react-router"
import { hasPageSignIn } from "~/components/layout/header"
import { m } from "~/paraglide/messages.js"
import Track, { handle } from "./track"

type Props = Parameters<typeof Track>[0]

function render(own: unknown, emailReady = true) {
  const props = {
    loaderData: { campus: "ITB", tenant: "KM ITB", own, emailReady },
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
    const own = { reports: [], capped: false }
    expect(render(own, false)).toContain(m.report_email_unverified())
    expect(render(own, true)).not.toContain(m.report_email_unverified())
  })
})
