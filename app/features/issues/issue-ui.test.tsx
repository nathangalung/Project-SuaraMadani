import { describe, expect, test } from "bun:test"
import type { ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { createRoutesStub } from "react-router"
import { m } from "~/paraglide/messages.js"
import { GOVERNMENT_STATUSES } from "../../../shared/status.ts"
import { IssueCard } from "./issue-card"
import { activeCategory, IssueFilters, issuesHref } from "./issue-filters"
import type { ListedIssue } from "./issues.server"
import { StatusTracker, TRACKER_STEPS, trackerState } from "./status-tracker"
import { issueHistory, Timeline } from "./timeline"

// Form needs a data router
function render(node: ReactNode): string {
  const Stub = createRoutesStub([{ path: "/", Component: () => node }])
  return renderToStaticMarkup(<Stub initialEntries={["/"]} />)
}

const ISSUE: ListedIssue = {
  code: "ISU-2026-10-0042",
  title: "Air bersih tidak mengalir",
  excerpt: "Distribusi air terhenti sejak awal bulan.",
  categoryId: "program",
  subcategoryId: "program.air_bersih",
  regencyName: "Kota Bandung",
  districtName: "Coblong",
  advocacyStatus: "referred",
  govStatus: "responded",
  verificationLabel: "verified",
  reportCount: 14,
  publishedAt: new Date("2026-10-01T03:00:00Z"),
  lastActivityAt: new Date("2026-10-12T03:00:00Z"),
}

describe("IssueCard", () => {
  test("the title is the one link and covers the card", () => {
    const html = render(<IssueCard issue={ISSUE} />)
    expect(html.match(/<a /g)).toHaveLength(1)
    expect(html).toContain('href="/isu/ISU-2026-10-0042"')
    expect(html).toContain("after:inset-0")
    expect(html).toContain("has-[a:focus-visible]:outline-focus")
  })

  test("marks name their axis, no badge boxes", () => {
    const html = render(<IssueCard issue={ISSUE} />)
    expect(html).toMatch(
      new RegExp(`${m.issue_stage_label()}: </span>.*Ditanggapi`),
    )
    expect(html).toContain("Program dan Pelayanan")
    expect(html).toContain("Aktivitas terakhir 12 Oktober 2026")
    expect(html).toContain("Coblong, Kota Bandung")
    expect(html).toContain(ISSUE.excerpt)
    expect(html).not.toMatch(/hari lalu|bg-danger text/)
    // Rounded card, no left bar
    expect(html).toContain("rounded-2xl")
    expect(html).not.toContain("border-l-")
  })
})

const REGIONS = {
  provinces: [
    { code: "32", name: "Jawa Barat" },
    { code: "34", name: "Daerah Istimewa Yogyakarta" },
  ],
  regencies: [{ code: "32.73", name: "Kota Bandung" }],
}

describe("issue filters", () => {
  test("a chip sets the category and keeps other filters", () => {
    expect(
      issuesHref({
        q: "air",
        status: "responded",
        kursor: "abc",
        kategori: "bansos",
      }),
    ).toBe("/isu?kategori=bansos&kursor=abc&q=air&status=responded")
    const html = render(
      <IssueFilters regions={REGIONS} query={{ q: "air", kursor: "abc" }} />,
    )
    expect(html).toContain('href="/isu?kategori=bencana&amp;q=air"')
    expect(html).not.toContain("kursor=abc")
  })

  test("phones fold the selects into one native disclosure", () => {
    const html = render(<IssueFilters regions={REGIONS} query={{}} />)
    // Closed in HTML, no shift
    const details = /<details([^>]*)>(.*?)<\/details>/s.exec(html)
    expect(details?.[1]).not.toContain("open")
    expect(details?.[1]).toContain(
      "::details-content]:[content-visibility:visible]",
    )
    expect(details?.[2]).toContain('name="status"')
    expect(details?.[2]).toContain('name="urut"')
    expect(details?.[2]).toContain('name="kategori"')
    expect(details?.[2]).not.toContain('name="q"')
    expect(details?.[2]).toMatch(/<summary[^>]*>[^<]*Saring dan urutkan/)
    const chosen = render(
      <IssueFilters regions={REGIONS} query={{ status: "responded" }} />,
    )
    expect(chosen).toMatch(/<details[^>]*open=""/)
  })

  test("the chip follows a chosen subcategory", () => {
    expect(activeCategory("bencana.banjir")).toBe("bencana")
    expect(activeCategory("bansos")).toBe("bansos")
    expect(activeCategory(undefined)).toBeUndefined()
    const html = render(
      <IssueFilters regions={REGIONS} query={{ kategori: "bencana.banjir" }} />,
    )
    const current = html.match(/<a[^>]*aria-current="true"[^>]*>.*?<\/a>/g)
    expect(current).toHaveLength(1)
    expect(current?.[0]).toContain("Kebencanaan")
    expect(current?.[0]).toContain('href="/isu?kategori=bencana"')
  })

  test("all subcategories keeps the active chip on submit", () => {
    const scoped = render(
      <IssueFilters regions={REGIONS} query={{ kategori: "bansos" }} />,
    )
    expect(scoped).toMatch(
      /<select[^>]*name="kategori"[^>]*><option value="bansos"/,
    )
    expect(scoped).not.toContain('<optgroup label="Kebencanaan')
    const open = render(<IssueFilters regions={REGIONS} query={{}} />)
    expect(open).toMatch(/<select[^>]*name="kategori"[^>]*><option value=""/)
    expect(open.match(/<optgroup/g)?.length).toBeGreaterThanOrEqual(3)
  })

  test("the form works without JS", () => {
    const html = render(<IssueFilters regions={REGIONS} query={{}} />)
    expect(html).toMatch(/<form[^>]*action="\/isu" method="get"/)
    expect(html).toContain('aria-describedby="issues-q-hint"')
  })

  test("an active region is named and removable", () => {
    const query = { wilayah: "32", status: "responded", kursor: "abc" }
    const html = render(
      <IssueFilters regions={REGIONS} query={query} regionName="Jawa Barat" />,
    )
    expect(html).toContain(`${m.issues_filter_region()}:`)
    expect(html).toContain("Jawa Barat")
    expect(html).toMatch(
      /<a[^>]*href="\/isu\?status=responded"[^>]*>Hapus saringan wilayah<\/a>/,
    )
    // Province chosen, its regencies open
    expect(html).toMatch(/<select[^>]*name="wilayah"/)
    expect(html).toMatch(/<option value="32" selected="">Jawa Barat</)
    expect(html).toContain('<optgroup label="Kabupaten/kota di Jawa Barat">')
    expect(html).toContain('<option value="32.73">Kota Bandung</option>')
    const none = render(<IssueFilters regions={REGIONS} query={{}} />)
    expect(none).not.toContain("Hapus saringan wilayah")
  })

  test("status filter lists the five public stages", () => {
    const html = render(<IssueFilters regions={REGIONS} query={{}} />)
    const select = html.slice(html.indexOf('id="issues-status"'))
    for (const label of [
      "Terverifikasi",
      "Diteruskan",
      "Ditanggapi",
      "Dalam penanganan",
      "Selesai",
    ]) {
      expect(select).toContain(`>${label}</option>`)
    }
    expect(select.slice(0, select.indexOf("</select>"))).not.toContain(
      "<optgroup",
    )
  })
})

describe("StatusTracker", () => {
  test("five public stages, one current", () => {
    const states = [
      { advocacy: "monitoring", government: "awaiting_response" },
      { advocacy: "referred", government: "awaiting_response" },
      { advocacy: "referred", government: "responded" },
      { advocacy: "referred", government: "in_progress" },
      { advocacy: "referred", government: "confirmed_resolved" },
    ] as const
    expect(TRACKER_STEPS).toEqual([
      "verified",
      "referred",
      "responded",
      "in_progress",
      "done",
    ])
    for (const [index, status] of states.entries()) {
      expect(trackerState(status)).toEqual({ reached: index, note: null })
      const html = render(<StatusTracker status={status} labelledBy="s" />)
      expect(html.match(/aria-current="step"/g)).toHaveLength(1)
      expect(html.match(/\(selesai\)/g)?.length ?? 0).toBe(index)
    }
  })

  test("hidden government statuses explain themselves", () => {
    const noted = GOVERNMENT_STATUSES.filter(
      (s) =>
        ![
          "awaiting_response",
          "responded",
          "in_progress",
          "confirmed_resolved",
        ].includes(s),
    )
    expect(noted).toHaveLength(5)
    for (const government of noted) {
      const status = { advocacy: "referred", government } as const
      const html = render(<StatusTracker status={status} labelledBy="s" />)
      expect(html.match(/aria-current="step"/g)).toHaveLength(1)
      expect(trackerState(status).note as string | null).toBe(government)
      expect(html).toContain("Status saat ini:")
    }
    // Claimed is not done yet
    expect(
      trackerState({ advocacy: "referred", government: "claimed_resolved" })
        .reached,
    ).toBe(3)
  })

  test("the list is labelled by its heading, never a progressbar", () => {
    const html = render(
      <StatusTracker
        status={{ advocacy: "referred", government: "responded" }}
        labelledBy="h"
      />,
    )
    expect(html).toMatch(/^<ol aria-labelledby="h"/)
    expect(html).not.toContain("progressbar")
  })
})

describe("Timeline", () => {
  test("newest first with machine dates", () => {
    const html = render(
      <Timeline
        entries={[
          { at: new Date("2026-10-01T00:00:00Z"), title: "Lama" },
          { at: new Date("2026-10-05T00:00:00Z"), title: "Baru" },
        ]}
      />,
    )
    expect(html.indexOf("Baru")).toBeLessThan(html.indexOf("Lama"))
    expect(html).toContain('dateTime="2026-10-05T00:00:00.000Z"')
  })

  test("issue history renders stored events with status text", () => {
    const publishedAt = new Date("2026-10-12T02:00:00Z")
    const entries = issueHistory({
      publishedAt,
      record: {
        referrals: [
          {
            id: "r1",
            kind: "referral",
            agency: "Dinas Pendidikan Kota Bandung",
            channel: "agency_service",
            ticket: "ADU-42",
            sentOn: "2026-10-13",
            deadlineOn: "2026-10-27",
          },
        ],
        responses: [],
        events: [
          {
            id: "e1",
            action: "refer",
            advocacyStatus: "referred",
            govStatus: "awaiting_response",
            referralId: "r1",
            responseId: null,
            note: null,
            occurredAt: new Date("2026-10-13T03:00:00Z"),
          },
          {
            id: "e2",
            action: "close",
            advocacyStatus: "referred",
            govStatus: "closed",
            referralId: null,
            responseId: null,
            note: "Sekolah sudah pindah gedung.",
            occurredAt: new Date("2026-10-20T03:00:00Z"),
          },
        ],
      },
    })
    expect(entries.map((entry) => entry.title)).toEqual([
      "Isu diterbitkan",
      "Diteruskan ke Dinas Pendidikan Kota Bandung via kanal pengaduan instansi",
      "Isu ditutup",
    ])
    expect(entries[1]).toMatchObject({
      body: "Tiket ADU-42 · Tenggat 27 Oktober 2026",
      status: "Status berubah: Diteruskan ke instansi",
      actor: "Admin",
    })
    expect(entries[2]).toMatchObject({
      body: "Sekolah sudah pindah gedung.",
      status: "Status berubah: Ditutup",
    })
  })

  test("a run of plain merges reads as one entry", () => {
    const merge = (id: string, day: number) => ({
      id,
      action: "merge" as const,
      advocacyStatus: "monitoring" as const,
      govStatus: "awaiting_response" as const,
      referralId: null,
      responseId: null,
      note: null,
      occurredAt: new Date(`2026-10-${day}T03:00:00Z`),
    })
    const entries = issueHistory({
      publishedAt: new Date("2026-10-12T02:00:00Z"),
      record: {
        referrals: [],
        responses: [],
        events: [
          merge("m1", 13),
          merge("m2", 14),
          merge("m3", 15),
          {
            ...merge("c1", 16),
            action: "mark_in_progress",
            govStatus: "in_progress",
          },
          merge("m4", 17),
        ],
      },
    })
    expect(entries.map((entry) => entry.title)).toEqual([
      "Isu diterbitkan",
      "3 laporan baru digabung ke isu ini",
      "Instansi mulai menangani",
      "Laporan baru digabung ke isu ini",
    ])
    expect(entries[1]).toMatchObject({
      id: "m1",
      at: new Date("2026-10-15T03:00:00Z"),
      body: "13 Oktober 2026 sampai 15 Oktober 2026",
    })
    // One day needs no range
    const sameDay = issueHistory({
      publishedAt: new Date("2026-10-12T02:00:00Z"),
      record: {
        referrals: [],
        responses: [],
        events: [
          merge("s1", 13),
          { ...merge("s2", 13), occurredAt: new Date("2026-10-13T09:00:00Z") },
        ],
      },
    })
    expect(sameDay[1]?.title).toBe("2 laporan baru digabung ke isu ini")
    expect(sameDay[1]?.body).toBeUndefined()
  })
})
