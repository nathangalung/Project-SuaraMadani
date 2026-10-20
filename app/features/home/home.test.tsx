import { describe, expect, test } from "bun:test"
import type { ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { createRoutesStub } from "react-router"
import { type DigestDemand, toDigest } from "../demands/digest.server"
import { DemandStrip } from "./demand-strip"
import { Hero } from "./hero"
import { IssueShowcase } from "./issue-showcase"

// Form needs a data router
function render(node: ReactNode): string {
  const Stub = createRoutesStub([{ path: "/", Component: () => node }])
  return renderToStaticMarkup(<Stub />)
}

const issue = {
  code: "ISU-ITB-26-0001",
  title: "Jalan berlubang di Dago",
  regencyName: "Kota Bandung",
  districtName: "Coblong",
  reportCount: 4,
  govStatus: "responded" as const,
}

const showcase = {
  id: "isu-terbaru",
  title: "Isu Terbaru",
  rule: "Aturan daftar.",
  empty: "Belum ada isu.",
  emptyBody: "Isu tampil di sini.",
  seeAll: { to: "/isu", label: "Lihat semua isu" },
}

describe("Hero", () => {
  test("other tenants get no KM ITB graphic or scroll motion", () => {
    const html = render(<Hero graphic={false} />)
    expect(html).not.toContain("/km-itb/")
    expect(html).not.toContain("hero-scroll")
    expect(html).toContain("max-w-3xl")
  })

  test("KM ITB graphic is decorative, rings load first", () => {
    const html = render(<Hero graphic />)
    expect(html).toContain("hero-scroll")
    expect(html).toContain('type="image/avif"')
    const imgs = html.match(/<img[^>]*>/g) ?? []
    expect(imgs.length).toBe(2)
    for (const img of imgs) {
      expect(img).toContain('alt=""')
      // Desktop LCP is the rings
      const rings = img.includes('src="/km-itb/rings-45.svg"')
      expect(img.includes('loading="lazy"')).toBe(!rings)
      expect(img.includes('fetchPriority="high"')).toBe(rings)
    }
    expect(html).toMatch(/<div aria-hidden="true" class="relative aspect/)
  })

  test("light panels keep the blue focus ring", () => {
    const html = render(<Hero graphic={false} />)
    expect(html).toMatch(/<form[^>]*class="[^"]*\bfocus-light\b/)
    expect(html).toMatch(/<h1[^>]*class="[^"]*focus-visible:outline-focus/)
  })

  test("heading reads as two sentences, CTAs in PLAN order", () => {
    const html = render(<Hero graphic={false} />)
    const h1 = html.match(/<h1[^>]*>(.*?)<\/h1>/)?.[1] ?? ""
    expect(h1.replace(/<[^>]+>/g, "")).toBe(
      "Laporkan Masalah Publik. Pantau Tanggapannya Bersama.",
    )
    const order = ['name="q"', 'href="/lapor"', 'href="/masuk?daftar=1"']
    const positions = order.map((needle) => html.indexOf(needle))
    expect(positions.every((at) => at > 0)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
    expect(html).toContain("Buat akun")
    expect(html).not.toContain('href="/lacak"')
    expect(html).not.toContain("18+")
    // Buttons sit on the hero
    expect(html).not.toContain("bg-ink text-surface-raised")
    // Search submit already opens /isu
    expect(html).not.toContain('href="/isu"')
  })

  test("only the controls hide while scrolled", () => {
    const html = render(<Hero graphic />)
    const actions = html.indexOf('class="hero-actions')
    expect(actions).toBeGreaterThan(html.indexOf("</h1>"))
    // No lead paragraph
    expect(html.slice(0, actions)).not.toContain("<p")
    const tail = html.slice(actions)
    for (const needle of [
      'role="search"',
      'href="/lapor"',
      'href="/masuk?daftar=1"',
    ]) {
      expect(tail).toContain(needle)
    }
  })

  test("signed in, no Buat akun", () => {
    const html = render(<Hero graphic={false} signedIn />)
    expect(html).toContain('href="/lapor"')
    expect(html).not.toContain("Buat akun")
  })

  test("heading is bold without faking display faces", () => {
    const h1 = render(<Hero graphic={false} />).match(/<h1[^>]*>/)?.[0] ?? ""
    expect(h1).toContain("font-bold")
    expect(h1).toContain("[font-synthesis-weight:none]")
  })
})

describe("IssueShowcase", () => {
  test("card link is named by the title, chip shows status", () => {
    const html = render(<IssueShowcase {...showcase} issues={[issue]} />)
    expect(html).toMatch(
      /<a class="[^"]*after:inset-0[^"]*" href="\/isu\/ISU-ITB-26-0001"[^>]*>Jalan berlubang di Dago<\/a>/,
    )
    expect(html).toContain(">Ditanggapi<")
    expect(html).toContain("bg-surface text-ink")
    expect(html).toContain("Coblong, Kota Bandung · 4 laporan")
    expect(html).toContain('<span aria-hidden="true"')
    expect(html).toContain('href="/isu"')
    expect(html).not.toContain("Belum ada isu.")
  })

  test("confirmed done reads green", () => {
    const done = { ...issue, govStatus: "confirmed_resolved" as const }
    const html = render(<IssueShowcase {...showcase} issues={[done]} />)
    expect(html).toContain("bg-success-soft text-success-ink")
    expect(html).toContain(">Selesai terkonfirmasi<")
  })

  test("short lists centre under the heading", () => {
    const html = render(<IssueShowcase {...showcase} issues={[issue]} />)
    const list = html.match(/<ul[^>]*class="([^"]*)"/)?.[1] ?? ""
    expect(list).toContain("flex-wrap")
    expect(list).toContain("justify-center")
    expect(list).not.toContain("grid-cols")
  })

  test("empty list states it plainly, with no dead link", () => {
    const html = render(<IssueShowcase {...showcase} issues={[]} />)
    expect(html).toContain("Belum ada isu.")
    expect(html).toContain("Isu tampil di sini.")
    expect(html).not.toContain("<a ")
  })
})

const demand: DigestDemand = toDigest({
  code: "TUN-ITB-26-0001",
  title: "Transparansi kuota bantuan biaya kuliah",
  scope: "national",
  category: "pendidikan",
  provinceName: null,
  regencyName: null,
  state: "published",
  progress: {
    status: "not_fulfilled",
    total: 2,
    responded: 1,
    fulfilled: 0,
    partial: 0,
    rejected: 0,
    open: 2,
  },
  importance: {
    raters: 12,
    counts: { 1: 0, 2: 0, 3: 2, 4: 4, 5: 6 },
    mean: 4.3,
  },
  marks: ["not_fulfilled", "not_fulfilled"],
  subs: ["Kuota per kampus diumumkan", "Kriteria penerima dibuka"],
  briefs: 0,
})

describe("DemandStrip", () => {
  test("nothing published, no section", () => {
    expect(render(<DemandStrip latest={[]} important={[]} />)).not.toContain(
      "<section",
    )
  })

  test("paints above the sticky hero, on the band", () => {
    const html = render(<DemandStrip latest={[demand]} important={[]} />)
    expect(html).toMatch(
      /<section aria-labelledby="tuntutan-terbaru" class="relative /,
    )
    expect(html).toContain("text-on-accent")
    expect(html).toContain("Tuntutan Nasional · Pendidikan")
    expect(html).toContain("0 dari 2 subtuntutan dipenuhi")
    // Score only for citizen row
    expect(html).not.toContain("4,3")
    expect(html).not.toContain("Paling Penting Menurut Warga")
  })

  test("card holds no chip, icon or pill", () => {
    const html = render(<DemandStrip latest={[demand]} important={[]} />)
    expect(html).not.toContain("bg-highlight")
    expect(html).not.toContain("<svg")
    expect(html).not.toContain("border-current")
    expect(html).not.toContain(">Lihat tuntutan<")
  })

  test("cards in the UI face, numbered in order", () => {
    const second = { ...demand, code: "TUN-ITB-26-0002" }
    const html = render(
      <DemandStrip latest={[demand, second]} important={[]} />,
    )
    const title = html.match(/<h4[^>]*>/)?.[0] ?? ""
    expect(title).toContain("font-ui")
    expect(html).toContain("<ol ")
    expect(html.indexOf(">01<")).toBeLessThan(html.indexOf(">02<"))
    expect(html).toMatch(/<span aria-hidden="true"[^>]*>01<\/span>/)
    expect(html).toContain('href="/tuntutan/TUN-ITB-26-0001"')
  })

  test("citizen order first, then the newest", () => {
    const html = render(<DemandStrip latest={[demand]} important={[demand]} />)
    const important = html.indexOf("Paling Penting Menurut Warga")
    const latest = html.indexOf(">Terbaru<")
    expect(important).toBeGreaterThan(0)
    expect(latest).toBeGreaterThan(important)
    expect(html).toContain("Kepentingan menurut warga 4,3 dari 5 · 12 penilai")
    // Row headings own the h3
    expect(html.match(/<h3 /g)).toHaveLength(2)
    expect(html.match(/<h4 /g)).toHaveLength(2)
  })

  test("sub-tuntutan lettered, only changes named, rest counted", () => {
    const subs = ["Satu", "Dua", "Tiga", "Empat", "Lima"].map(
      (word) => `Subtuntutan ${word}`,
    )
    const many = {
      ...demand,
      subs,
      marks: subs.map(() => "fulfilled" as const),
    }
    const html = render(<DemandStrip latest={[many]} important={[]} />)
    expect(html).toContain("Subtuntutan Tiga")
    expect(html).not.toContain("Subtuntutan Empat")
    expect(html).toMatch(/<span aria-hidden="true"[^>]*>c\.<\/span>/)
    expect(html).toContain(">Dipenuhi<")
    expect(html).toContain("+2 subtuntutan lain")
    const two = render(<DemandStrip latest={[demand]} important={[]} />)
    expect(two).toContain("Kriteria penerima dibuka")
    expect(two).not.toContain("Belum dipenuhi")
    expect(two).not.toContain("subtuntutan lain")
  })

  test("only citizen picks still render", () => {
    const html = render(<DemandStrip latest={[]} important={[demand]} />)
    expect(html).toContain("Paling Penting Menurut Warga")
    expect(html).not.toContain(">Terbaru<")
  })
})
