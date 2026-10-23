import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { createRoutesStub } from "react-router"
import type { ManagedIssue } from "~/features/moderation/queue.server"
import { m } from "~/paraglide/messages.js"
import type { Route } from "./+types/issue"
import ManageIssue from "./issue"

const issue: ManagedIssue = {
  id: "0199c2b0-1d2e-7000-8000-000000000001",
  code: "ISU-2026-10-0001",
  title: "Jalan berlubang di Dago",
  summary: "Warga melaporkan lubang besar.",
  verificationLabel: "verified",
  advocacyStatus: "monitoring",
  govStatus: "awaiting_response",
  reportCount: 2,
  regencyName: "Kota Bandung",
  publishedAt: null,
  takenDownAt: null,
  version: 1,
  subcategoryId: "program.pendidikan",
  regencyCode: "32.73",
  reports: [],
  record: { referrals: [], responses: [], events: [] },
}

function render(publishedAt: Date | null) {
  const props = {
    loaderData: {
      issue: { ...issue, publishedAt },
      regencies: [
        {
          code: "32",
          name: "Jawa Barat",
          regencies: [{ code: "32.73", name: "Kota Bandung" }],
        },
      ],
      state: { advocacy: "monitoring", government: "awaiting_response" },
      actions: publishedAt ? ["refer", "close"] : [],
      referral: null,
      escalation: null,
      wait: null,
      defaults: { today: "2026-10-15", deadline: "2026-10-29", agency: "" },
    },
    actionData: undefined,
  } as unknown as Route.ComponentProps
  const Stub = createRoutesStub([
    { path: "/", Component: () => <ManageIssue {...props} /> },
  ])
  return renderToStaticMarkup(<Stub initialEntries={["/"]} />)
}

describe("ManageIssue publish section", () => {
  test.each([
    ["unpublished", null],
    ["published", new Date("2026-10-01T00:00:00Z")],
  ] as const)("%s: every aria-labelledby target exists", (_, at) => {
    const html = render(at)
    const refs = [...html.matchAll(/aria-labelledby="([^"]+)"/g)]
    for (const [, id] of refs) expect(html).toContain(`id="${id}"`)
  })
})

describe("ManageIssue edit and legal takedown", () => {
  test("edit form prefilled, place and category selected", () => {
    const html = render(null)
    expect(html).toContain(m.manage_edit_title())
    expect(html).toMatch(/<option value="32.73" selected="">Kota Bandung</)
    expect(html).toMatch(/<option value="program.pendidikan" selected="">/)
    expect(html).toContain('name="version" value="1"')
  })

  test("edit and takedown sit under their own heading", () => {
    const html = render(new Date("2026-10-01T00:00:00Z"))
    const heading = html.indexOf(`>${m.manage_issue_admin_title()}</h2>`)
    expect(heading).toBeGreaterThan(
      html.indexOf(`>${m.manage_actions_title()}</h2>`),
    )
    expect(html.indexOf(m.manage_edit_title())).toBeGreaterThan(heading)
    expect(html.indexOf(m.manage_legal_title())).toBeGreaterThan(heading)
    expect(m.manage_legal_decision_legend()).not.toBe(m.manage_actions_title())
  })

  test("unpublished issues can only be taken down", () => {
    const hidden = render(null)
    expect(hidden).toContain(m.manage_legal_title())
    expect(hidden).not.toContain('value="hide"')
    expect(hidden).toContain('value="remove"')
    const live = render(new Date("2026-10-01T00:00:00Z"))
    expect(live).toContain('value="hide"')
    expect(live).toContain('value="komdigi_order"')
  })
})
