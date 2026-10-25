import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { createRoutesStub } from "react-router"
import { m } from "~/paraglide/messages.js"
import { FollowCard, type FollowState } from "./follow-card"

function render(state: FollowState, kind: "issue" | "demand" = "issue") {
  const Stub = createRoutesStub([
    {
      path: "/isu/ISU-2026-10-0001",
      Component: () => (
        <FollowCard code="ISU-2026-10-0001" state={state} kind={kind} />
      ),
    },
  ])
  return renderToStaticMarkup(
    <Stub initialEntries={["/isu/ISU-2026-10-0001"]} />,
  )
}

describe("FollowCard", () => {
  test("an unproven email is told no mail comes yet", () => {
    for (const kind of ["issue", "demand"] as const) {
      const html = render({ following: true, emailReady: false }, kind)
      expect(html).toContain(m.follow_email_unverified())
      expect(html).not.toContain(m.issue_following())
      expect(html).not.toContain(m.demand_following())
    }
  })

  test("a proven email keeps the promise", () => {
    const html = render({ following: false, emailReady: true })
    expect(html).toContain(m.issue_follow_body())
    expect(html).not.toContain(m.follow_email_unverified())
  })
})
