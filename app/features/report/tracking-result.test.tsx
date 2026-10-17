import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { createRoutesStub } from "react-router"
import { m } from "~/paraglide/messages.js"
import type { TrackedReport } from "./tracking.server"
import { TrackingResult } from "./tracking-result"

const BASE: TrackedReport = {
  code: "ITB-26-7K3QX",
  title: "Atap sekolah runtuh",
  status: "in_review",
  createdAt: new Date("2026-10-13T03:00:00Z"),
  verifiedAt: null,
  merged: null,
  evidence: ["ready", "awaiting_upload"],
  decision: null,
  forwardedTo: null,
  pendingUploads: [],
  uploadUntil: null,
}

function render(
  reports: TrackedReport[],
  capped = false,
  canUpload = true,
): string {
  // Data router for useRevalidator
  const Stub = createRoutesStub([
    {
      path: "/lacak",
      Component: () => (
        <TrackingResult
          campus="ITB"
          tenant="KM ITB"
          reports={reports}
          capped={capped}
          canUpload={canUpload}
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
    const html = render([PENDING], false, false)
    expect(html).toContain(m.track_upload_sign_in())
    expect(html).not.toContain('type="file"')
  })

  test("nothing shows without pending files", () => {
    expect(render([BASE])).not.toContain(m.track_upload_title())
  })
})

describe("TrackingResult", () => {
  test("a rejection shows the standard, guidance and its anchor", () => {
    const html = render([
      {
        ...BASE,
        status: "rejected",
        decision: { reason: "standard_3", text: "Laporkan layanannya." },
      },
    ])
    expect(html).toContain("Standar 3: Tidak menuduh orang")
    expect(html).toContain("Laporkan layanannya.")
    expect(html).toContain('href="/pedoman#standar-3"')
  })

  test("a forward links the other campus page", () => {
    const html = render([
      {
        ...BASE,
        status: "forwarded",
        forwardedTo: { campus: "UGM", url: "http://ugm.localhost/lacak" },
      },
    ])
    expect(html).toContain('href="http://ugm.localhost/lacak"')
    expect(html).toContain("Laporan saya di UGM")
  })

  test("lists code, status label and received files", () => {
    const html = render([BASE])
    expect(html).toContain("ITB-26-7K3QX")
    expect(html).toContain("Sedang diperiksa")
    expect(html).toContain("1 dari 2 diterima")
    expect(html).toContain("13 Oktober 2026")
    // Page h1 already says this
    expect(html).not.toContain(m.track_title())
  })

  test("each report is a card with its own heading, no table", () => {
    const html = render([BASE, { ...BASE, code: "ITB-26-8M4RY" }])
    expect(html).not.toContain("<table")
    expect(html.match(/<article/g)).toHaveLength(2)
    expect(html.match(/<h2 /g)).toHaveLength(2)
    expect(html).toContain('aria-labelledby="report-ITB-26-8M4RY"')
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
      { ...BASE, ...pending, code: "ITB-26-8M4RY" },
    ])
    const names = [...html.matchAll(/<section aria-labelledby="([^"]+)"/g)].map(
      (match) => match[1],
    )
    expect(names).toHaveLength(4)
    expect(new Set(names).size).toBe(4)
    for (const name of names) expect(name).toMatch(/ report-ITB-26-/)
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
        merged: { at: new Date(), code: "ISU-ITB-26-0042" },
      },
    ])
    expect(shown).toContain(m.track_merged_note())
    expect(shown).toContain('href="/isu/ISU-ITB-26-0042"')
  })

  test("a merge into an unpublished issue says why no link", () => {
    const html = render([
      { ...BASE, status: "merged", merged: { at: new Date(), code: null } },
    ])
    expect(html).toContain(m.track_merged_pending())
    const linked = render([
      { ...BASE, merged: { at: new Date(), code: "ISU-ITB-26-0042" } },
    ])
    expect(linked).not.toContain(m.track_merged_pending())
    expect(render([BASE])).not.toContain(m.track_merged_pending())
  })

  test("a list ends with one report link and notes its cap", () => {
    const html = render([BASE])
    expect(html.match(/href="\/lapor"/g)).toHaveLength(1)
    expect(html.indexOf(m.track_closing())).toBeGreaterThan(
      html.lastIndexOf("</article>"),
    )
    expect(html).not.toContain("laporan terbaru dari akun ini")
    expect(render([BASE], true)).toContain(
      "Menampilkan 1 laporan terbaru dari akun ini.",
    )
  })

  test("says when there are no reports", () => {
    const html = render([])
    expect(html).toContain("Belum ada laporan dari akun ini di ITB.")
    expect(html.match(/<a /g)).toHaveLength(1)
    expect(html).toContain('href="/lapor"')
  })
})
