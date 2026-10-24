import { describe, expect, test } from "bun:test"
import type { ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { createRoutesStub, Outlet } from "react-router"
import type { ComplaintDetail } from "~/features/moderation/complaints.server"
import type {
  ManagedIssue,
  ReviewReport,
} from "~/features/moderation/queue.server"
import { m } from "~/paraglide/messages.js"
import ManageComplaint from "./complaint"
import ManageComplaints from "./complaints"
import ManageIssue from "./issue"
import ManageLayout from "./layout"
import Members from "./members"
import Queue from "./queue"
import ManageReport from "./report"
import Settings from "./settings"

const SITE = "Sadar Bersuara · KM ITB"

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
      forwardConsent: false,
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
    expect(html).toContain(`<title>${m.manage_queue_title()} · ${SITE}</title>`)
    // Sub-nav matches the H1
    expect(html).toMatch(
      new RegExp(`href="/kelola/antrean"[^>]*>${m.manage_queue_title()}</a>`),
    )
    expect(html).toContain(m.manage_queue_lead())
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
      `<title>${m.manage_report_title({ code: report.code })} · ${SITE}</title>`,
    )
    expect(html.match(/href="\/kelola"/g)?.length).toBe(1)
    // Pill in a raised strip
    const back = html.match(/<a[^>]*href="\/kelola"[^>]*>/)?.[0] ?? ""
    expect(back).not.toContain('aria-current="page"')
    const tokens = (back.match(/class="([^"]*)"/)?.[1] ?? "").split(" ")
    expect(tokens).toContain("rounded-full")
    expect(html).toMatch(/<ul class="[^"]*rounded-full[^"]*bg-surface-raised/)
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
      `<title>${m.manage_issue_page_title({ code: issue.code })} · ${SITE}</title>`,
    )
    const heading = html.indexOf(m.manage_issue_reports_title())
    expect(heading).toBeGreaterThan(-1)
    expect(heading).toBeLessThan(html.indexOf('href="/kelola/laporan/'))
  })

  const complaint: ComplaintDetail = {
    id: "0199c2b0-1d2e-7000-8000-000000000009",
    code: "ADU-ITB-26-7K3QX",
    status: "appealed",
    reason: "personal_data",
    part: "title_summary",
    explanation: "Ringkasan menyebut alamat rumah warga.",
    createdAt: new Date("2026-10-10T03:00:00Z"),
    first: {
      decision: "keep",
      reason: "no_violation",
      text: "Ringkasan tidak memuat alamat siapa pun.",
      by: "0199c2b0-aaaa-7000-8000-000000000001",
      at: new Date("2026-10-11T03:00:00Z"),
    },
    appeal: {
      text: "Alamat masih tampil di paragraf kedua.",
      at: new Date("2026-10-12T03:00:00Z"),
    },
    appealDecision: null,
    demand: null,
    issue: {
      id: issue.id,
      code: issue.code,
      title: issue.title,
      summary: issue.summary,
      version: 3,
      publishedAt: new Date("2026-10-09T03:00:00Z"),
      takenDownAt: null,
      redactedAt: null,
    },
    evidence: [],
    takedowns: [
      {
        id: "0199c2b0-1d2e-7000-8000-00000000000a",
        action: "redact",
        purgeStatus: "retrying",
        createdAt: new Date("2026-10-11T03:00:00Z"),
        doneAt: null,
      },
    ],
  }

  function complaintPage(viewer: string, blocked: boolean) {
    const props = {
      loaderData: {
        complaint,
        stage: "appeal",
        blocked,
        viewer,
        dueAt: new Date("2026-10-17T03:00:00Z"),
      },
      actionData: undefined,
    } as unknown as Props<typeof ManageComplaint>
    return render(() => <ManageComplaint {...props} />)
  }

  test("complaint: the first admin gets no appeal form", () => {
    const html = complaintPage(complaint.first?.by ?? "", true)
    expect(html).toContain(m.manage_appeal_other_admin())
    expect(html).not.toContain('name="intent"')
    expect(html).toContain(m.manage_decided_by_you())
    // Purge status visible
    expect(html).toContain(m.manage_purge_retrying())
  })

  test("complaint: another admin gets one panel per decision", () => {
    const html = complaintPage("0199c2b0-bbbb-7000-8000-000000000002", false)
    for (const decision of ["keep", "edit", "hide", "remove"]) {
      expect(html).toContain(`id="putusan-${decision}"`)
    }
    expect(html).toContain('name="stage" value="appeal"')
    expect(html).toContain('name="subjectVersion" value="3"')
    expect(html).toContain(
      `<title>${m.manage_complaint_title({ code: complaint.code })} · ${SITE}</title>`,
    )
  })

  test("complaints: tabs, table and the sub-nav name", () => {
    const props = {
      loaderData: {
        current: "banding",
        capped: false,
        rows: [
          {
            code: complaint.code,
            status: "appealed",
            reason: "personal_data",
            subject: { kind: "issue", code: issue.code, title: issue.title },
            createdAt: complaint.createdAt,
          },
        ],
      },
    } as unknown as Props<typeof ManageComplaints>
    const html = render(() => <ManageComplaints {...props} />)
    expect(html).toMatch(
      new RegExp(
        `href="/kelola/aduan"[^>]*>${m.manage_complaints_title()}</a>`,
      ),
    )
    expect(html).toMatch(
      /aria-current="page"[^>]*href="\/kelola\/aduan\?status=banding"/,
    )
    expect(html).toContain(`href="/kelola/aduan/${complaint.code}"`)
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
    expect(html).toContain(`<title>${m.team_title()} · ${SITE}</title>`)
    expect(html).toContain(m.team_invite_title())
    expect(html).toContain(m.team_totp_on())
    expect(html).toContain(m.team_totp_off())
    // Own row: no self-removal
    expect(html).toContain(m.team_self_note())
    expect(html).toContain('id="remove-0199c2b0-1d2e-7000-8000-00000000000b"')
    expect(html).not.toContain(
      'id="remove-0199c2b0-1d2e-7000-8000-00000000000a"',
    )
    expect(html).not.toContain('name="role"')
    expect(html).toContain(m.team_lead({ operator: "KM ITB" }))
  })

  test("settings: four sections and a live preview", () => {
    const props = {
      loaderData: {
        theme: { brand: "#176bff" },
        intakePaused: true,
        globalPause: false,
        statusUrl: null,
        logoFile: null,
        identity: {
          name: "KM ITB",
          campusName: "Institut Teknologi Bandung",
          contactEmail: null,
          alliance: null,
          legalNumber: null,
          credit: null,
          officers: ["Ketua: Ani Rahma"],
        },
        campus: "Institut Teknologi Bandung",
      },
      actionData: undefined,
    } as unknown as Props<typeof Settings>
    const html = render(() => <Settings {...props} />)
    expect(html).toContain(`<title>${m.settings_title()} · ${SITE}</title>`)
    for (const heading of [
      m.settings_intake_title(),
      m.settings_identity_title(),
      m.settings_logo_title(),
      m.settings_theme_title(),
    ]) {
      expect(html).toContain(`>${heading}</h2>`)
    }
    // One officer per line
    expect(html).toContain(">Ketua: Ani Rahma</textarea>")
    expect(html).toContain(m.settings_intake_paused())
    expect(html).toContain("--theme-brand:#176bff")
    expect(html).toMatch(/enctype="multipart\/form-data"/i)
  })
})
