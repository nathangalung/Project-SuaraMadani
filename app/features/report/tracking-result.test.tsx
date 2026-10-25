import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { createRoutesStub } from "react-router"
import { m } from "~/paraglide/messages.js"
import type { TrackedReport } from "./tracking.server"
import { TrackingResult } from "./tracking-result"

const BASE: TrackedReport = {
  code: "LPR-2026-10-0001",
  title: "Atap sekolah runtuh",
  status: "in_review",
  createdAt: new Date("2026-10-13T03:00:00Z"),
  verifiedAt: null,
  merged: null,
  evidence: ["ready", "awaiting_upload"],
  decision: null,
  pendingUploads: [],
  uploadUntil: null,
}

function render(
  reports: TrackedReport[],
  canUpload = true,
  pages: { page: number; pageCount: number } = { page: 1, pageCount: 1 },
): string {
  // Data router for useRevalidator
  const Stub = createRoutesStub([
    {
      path: "/lacak",
      Component: () => (
        <TrackingResult
          campus="ITB"
          reports={reports}
          canUpload={canUpload}
          {...pages}
          pageHref={(page) => `/lacak?halaman=${page}`}
        />
      ),
    },
  ])
  return renderToStaticMarkup(<Stub initialEntries={["/lacak"]} />)
}

const PENDING: TrackedReport = {
  ...BASE,
  pendingUploads: [
    {
      id: "0192a1b2-0000-7000-8000-000000000001",
      position: 1,
      name: "rekaman.mov",
      kind: "video",
      size: 4_000_000,
    },
  ],
  uploadUntil: new Date("2026-10-14T03:00:00Z"),
}

describe("pending uploads on /lacak", () => {
  test("the owner gets a file input per missing file", () => {
    const html = render([PENDING])
    expect(html).toContain(m.track_upload_title())
    expect(html).toContain("rekaman.mov")
    expect(html).toMatch(/<input[^>]*type="file"[^>]*accept="video\/\*"/)
    expect(html).toContain(m.track_upload_choose({ name: "rekaman.mov" }))
  })

  test("a signed link asks to sign in instead", () => {
    const html = render([PENDING], false)
    expect(html).toContain(m.track_upload_sign_in())
    expect(html).not.toContain('type="file"')
  })

  test("nothing shows without pending files", () => {
    expect(render([BASE])).not.toContain(m.track_upload_title())
  })
})

describe("TrackingResult", () => {
  test("a decision shows only the admin's text", () => {
    const html = render([
      {
        ...BASE,
        status: "unverifiable",
        decision: { text: "Laporkan layanannya." },
      },
    ])
    expect(html).toContain(m.track_reason_text())
    expect(html).toContain("Laporkan layanannya.")
    // Free text, no standards
    expect(html).not.toContain("Standar")
    expect(html).not.toContain("/pedoman#standar")
  })

  test("lists code, status label and received files", () => {
    const html = render([BASE])
    expect(html).toContain("LPR-2026-10-0001")
    expect(html).toContain("Sedang diperiksa")
    expect(html).toContain("1 dari 2 diterima")
    expect(html).toContain("13 Oktober 2026")
    // Page h1 already says this
    expect(html).not.toContain(m.track_title())
  })

  test("each report is a card with its own heading, no table", () => {
    const html = render([BASE, { ...BASE, code: "LPR-2026-10-0002" }])
    expect(html).not.toContain("<table")
    expect(html.match(/<article/g)).toHaveLength(2)
    expect(html.match(/<h2 /g)).toHaveLength(2)
    expect(html).toContain('aria-labelledby="report-LPR-2026-10-0002"')
  })

  test("each card's regions have their own names", () => {
    const pending = {
      pendingUploads: [
        {
          id: "e1",
          position: 1,
          name: "b.png",
          kind: "image" as const,
          size: 10,
        },
      ],
      uploadUntil: new Date("2026-10-14T03:00:00Z"),
    }
    const html = render([
      { ...BASE, ...pending },
      { ...BASE, ...pending, code: "LPR-2026-10-0002" },
    ])
    const names = [...html.matchAll(/<section aria-labelledby="([^"]+)"/g)].map(
      (match) => match[1],
    )
    expect(names).toHaveLength(4)
    expect(new Set(names).size).toBe(4)
    for (const name of names) expect(name).toMatch(/ report-LPR-2026-10-/)
  })

  test("history shows only stored dates, newest first", () => {
    const html = render([
      {
        ...BASE,
        status: "merged",
        verifiedAt: new Date("2026-10-14T03:00:00Z"),
        merged: { at: new Date("2026-10-15T03:00:00Z"), code: null },
      },
    ])
    const order = [
      m.track_event_merged(),
      m.track_event_verified(),
      m.track_event_sent(),
    ].map((text) => html.indexOf(text))
    expect(order.every((at) => at > 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(html).toContain('dateTime="2026-10-15T03:00:00.000Z"')
  })

  test("the merged panel links only a public issue", () => {
    const hidden = render([
      { ...BASE, status: "merged", merged: { at: new Date(), code: null } },
    ])
    expect(hidden).not.toContain(m.track_merged_note())
    expect(hidden).not.toContain('href="/isu/')
    const shown = render([
      {
        ...BASE,
        status: "merged",
        merged: { at: new Date(), code: "ISU-2026-10-0042" },
      },
    ])
    expect(shown).toContain(m.track_merged_note())
    expect(shown).toContain('href="/isu/ISU-2026-10-0042"')
  })

  test("a merge into an unpublished issue says why no link", () => {
    const html = render([
      { ...BASE, status: "merged", merged: { at: new Date(), code: null } },
    ])
    expect(html).toContain(m.track_merged_pending())
    const linked = render([
      { ...BASE, merged: { at: new Date(), code: "ISU-2026-10-0042" } },
    ])
    expect(linked).not.toContain(m.track_merged_pending())
    expect(render([BASE])).not.toContain(m.track_merged_pending())
  })

  test("a list ends with one report link and pages", () => {
    const html = render([BASE])
    expect(html.match(/href="\/lapor"/g)).toHaveLength(1)
    expect(html.indexOf(m.track_closing())).toBeGreaterThan(
      html.lastIndexOf("</article>"),
    )
    expect(html).not.toContain(m.issues_next())
    const paged = render([BASE], true, { page: 2, pageCount: 3 })
    expect(paged).toContain(m.issues_page_of({ page: 2, pages: 3 }))
    expect(paged).toContain('href="/lacak?halaman=1"')
    expect(paged).toContain('href="/lacak?halaman=3"')
  })

  test("says when there are no reports", () => {
    const html = render([])
    expect(html).toContain("Belum ada laporan dari akun ini di ITB.")
    expect(html.match(/<a /g)).toHaveLength(1)
    expect(html).toContain('href="/lapor"')
  })
})
