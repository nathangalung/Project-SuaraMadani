import { describe, expect, test } from "bun:test"
import type { ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { createRoutesStub, Outlet } from "react-router"
import type {
  ManagedIssue,
  ReviewReport,
} from "~/features/moderation/queue.server"
import { m } from "~/paraglide/messages.js"
import ManageIssue from "./issue"
import ManageLayout from "./layout"
import Members from "./members"
import Queue from "./queue"
import ManageReport from "./report"
import Settings from "./settings"

const SITE = "Sadar Bersuara - KM ITB"
// Icon before each label
const ICON = "<svg[^>]*>.*?</svg>"

// Root data supplies site name
function render(page: () => ReactNode) {
  const Stub = createRoutesStub([
    {
      id: "root",
      path: "/",
      Component: () => <Outlet />,
      children: [
        {
          path: "kelola",
          Component: ManageLayout,
          children: [{ path: "x", Component: page }],
        },
      ],
    },
  ])
  return renderToStaticMarkup(
    <Stub
      initialEntries={["/kelola/x"]}
      hydrationData={{ loaderData: { root: { siteName: "KM ITB" } } }}
    />,
  )
}

type Props<T extends (...args: never[]) => unknown> = Parameters<T>[0]

const report = {
  id: "0199c2b0-1d2e-7000-8000-000000000002",
  code: "LPR-2026-10-0001",
  status: "submitted",
  relation: "self",
  otherConsent: null,
  title: "Trotoar rusak di Jalan Ganesha",
  story: "Trotoar rusak sejak sebulan lalu dan membahayakan pejalan kaki.",
  categoryId: "program",
  subcategoryId: "program.infrastruktur",
  occurredOn: "2026-10-01",
  agency: null,
  urgency: "medium",
  affectedGroups: ["public"],
  affectedCount: "11-100",
  ongoing: "yes",
  contactable: false,
  provinceName: "Jawa Barat",
  regencyName: "Kota Bandung",
  districtName: "Coblong",
  villageName: null,
  createdAt: new Date("2026-10-14T03:00:00Z"),
  verifiedAt: null,
  evidence: [],
  issue: null,
} as unknown as ReviewReport

const issue: ManagedIssue = {
  id: "0199c2b0-1d2e-7000-8000-000000000001",
  code: "ISU-2026-10-0001",
  title: "Jalan berlubang di Dago",
  summary: "Warga melaporkan lubang besar.",
  verificationLabel: "verified",
  advocacyStatus: "monitoring",
  govStatus: "awaiting_response",
  reportCount: 1,
  regencyName: "Kota Bandung",
  publishedAt: null,
  takenDownAt: null,
  version: 1,
  subcategoryId: "program.pendidikan",
  regencyCode: "32.73",
  reports: [
    {
      code: "LPR-2026-10-0001",
      title: "Jalan berlubang",
    },
  ],
  record: { referrals: [], responses: [], events: [] },
}

describe("manage pages", () => {
  test("queue: one name for nav and H1, a lead, a site title", () => {
    const html = render(() => (
      <Queue
        {...({ loaderData: { rows: [], status: null } } as unknown as Props<
          typeof Queue
        >)}
      />
    ))
    expect(html).toContain(`<title>${m.manage_queue_title()} - ${SITE}</title>`)
    // Sub-nav matches the H1
    expect(html).toMatch(
      new RegExp(
        `href="/kelola/antrean"[^>]*>${ICON}${m.manage_queue_title()}</a>`,
      ),
    )
    expect(html).toContain(m.manage_queue_lead())
    expect(html).not.toContain('href="/kelola/aduan')
  })

  test("report: the sub-nav is the only way back", () => {
    const props = {
      loaderData: {
        report: {
          ...report,
          decision: null,
          forwardedFrom: null,
          forwardedTo: null,
        },
        actions: ["start"],
        targets: [],
        campuses: [],
        copyCode: null,
      },
      actionData: undefined,
    } as unknown as Props<typeof ManageReport>
    const html = render(() => <ManageReport {...props} />)
    expect(html).toContain(
      `<title>${m.manage_report_title({ code: report.code })} - ${SITE}</title>`,
    )
    // Brand and item, twice each
    const links = html.match(/<a[^>]*href="\/kelola"[^>]*>/g) ?? []
    expect(links).toHaveLength(4)
    expect(links.join("")).not.toContain('aria-current="page"')
    const back = links[1] ?? ""
    const tokens = (back.match(/class="([^"]*)"/)?.[1] ?? "").split(" ")
    expect(tokens).toContain("aria-[current=page]:bg-brand")
  })

  test("issue: the report list has a heading, a site title", () => {
    const props = {
      loaderData: {
        issue,
        regencies: [],
        state: { advocacy: "monitoring", government: "awaiting_response" },
        actions: [],
        referral: null,
        escalation: null,
        wait: null,
        defaults: { today: "2026-10-15", deadline: "2026-10-29", agency: "" },
      },
      actionData: undefined,
    } as unknown as Props<typeof ManageIssue>
    const html = render(() => <ManageIssue {...props} />)
    expect(html).toContain(
      `<title>${m.manage_issue_page_title({ code: issue.code })} - ${SITE}</title>`,
    )
    const heading = html.indexOf(m.manage_issue_reports_title())
    expect(heading).toBeGreaterThan(-1)
    expect(heading).toBeLessThan(html.indexOf('href="/kelola/laporan/'))
  })

  test("members: invite form, admin rows with second factor state", () => {
    const props = {
      loaderData: {
        members: [
          {
            userId: "0199c2b0-1d2e-7000-8000-00000000000a",
            email: "admin@kampus.ac.id",
            role: "admin",
            twoFactor: true,
            joinedAt: new Date("2026-10-01T03:00:00Z"),
          },
          {
            userId: "0199c2b0-1d2e-7000-8000-00000000000b",
            email: "rekan@kampus.ac.id",
            role: "admin",
            twoFactor: false,
            joinedAt: new Date("2026-10-02T03:00:00Z"),
          },
        ],
        invitations: [],
        selfId: "0199c2b0-1d2e-7000-8000-00000000000a",
        operator: "KM ITB",
      },
      actionData: undefined,
    } as unknown as Props<typeof Members>
    const html = render(() => <Members {...props} />)
    expect(html).toContain(`<title>${m.team_title()} - ${SITE}</title>`)
    expect(html).toContain(m.team_invite_title())
    // No two-step badges, 25 Oct
    expect(html).not.toContain("Dua langkah")
    // Own row: no self-removal
    expect(html).toContain(m.team_self_note())
    expect(html).toContain('id="remove-0199c2b0-1d2e-7000-8000-00000000000b"')
    expect(html).not.toContain(
      'id="remove-0199c2b0-1d2e-7000-8000-00000000000a"',
    )
    expect(html).not.toContain('name="role"')
    expect(html).toContain(m.team_lead({ operator: "KM ITB" }))
  })

  test("settings: intake only", () => {
    const props = {
      loaderData: {
        intakePaused: true,
        globalPause: false,
        statusUrl: null,
        campus: "Institut Teknologi Bandung",
      },
      actionData: undefined,
    } as unknown as Props<typeof Settings>
    const html = render(() => <Settings {...props} />)
    expect(html).toContain(`<title>${m.settings_title()} - ${SITE}</title>`)
    expect(html).toContain(`>${m.settings_intake_title()}</h2>`)
    // No identity, logo, theme
    expect(html.match(/<h2/g)).toHaveLength(1)
    expect(html).not.toContain("Identitas Pengelola")
    expect(html).toContain(m.settings_intake_paused())
    expect(html).not.toMatch(/enctype="multipart\/form-data"/i)
  })
})
