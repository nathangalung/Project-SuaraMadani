import { describe, expect, test } from "bun:test"
import type { ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { createRoutesStub } from "react-router"
import { Hero } from "./hero"
import { HowItWorks } from "./how-it-works"
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
  lastActivityAt: new Date(Date.UTC(2026, 9, 5, 3)),
}

const showcase = {
  id: "baru-ditanggapi",
  title: "Baru Ditanggapi Instansi",
  tone: "brand" as const,
  rule: "Aturan daftar.",
  chip: "bg-surface text-ink",
  empty: "Belum ada isu.",
  emptyBody: "Isu tampil di sini.",
  seeAll: { to: "/isu?status=responded", label: "Lihat semua" },
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
    const order = ['name="q"', 'href="/lapor"', 'href="/lacak"']
    const positions = order.map((needle) => html.indexOf(needle))
    expect(positions.every((at) => at > 0)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
    expect(html).not.toContain("Buat akun")
    // Search submit already opens /isu
    expect(html).not.toContain('href="/isu"')
  })

  test("only the controls hide while scrolled", () => {
    const html = render(<Hero graphic />)
    const actions = html.indexOf('class="hero-actions')
    expect(actions).toBeGreaterThan(html.indexOf("</h1>"))
    expect(actions).toBeGreaterThan(html.indexOf("</p>"))
    const tail = html.slice(actions)
    for (const needle of ['role="search"', 'href="/lapor"', 'href="/lacak"']) {
      expect(tail).toContain(needle)
    }
  })

  test("heading is bold without faking display faces", () => {
    const h1 = render(<Hero graphic={false} />).match(/<h1[^>]*>/)?.[0] ?? ""
    expect(h1).toContain("font-bold")
    expect(h1).toContain("[font-synthesis-weight:none]")
  })
})

describe("HowItWorks", () => {
  test("four ordered steps, numbers hidden, visible by default", () => {
    const html = render(<HowItWorks />)
    expect(html.match(/<li /g)).toHaveLength(4)
    expect(
      html.match(/<span aria-hidden="true"[^>]*>0\d<\/span>/g),
    ).toHaveLength(4)
    expect(html).not.toMatch(/class="[^"]*\bstagger\b/)
    expect(html).toContain('style="--i:3"')
  })

  test("paints above the sticky hero", () => {
    const html = render(<HowItWorks />)
    expect(html).toMatch(
      /<section aria-labelledby="cara-kerja" class="relative"/,
    )
  })
})

describe("IssueShowcase", () => {
  test("card link is named by the title and dated", () => {
    const html = render(<IssueShowcase {...showcase} issues={[issue]} />)
    expect(html).toMatch(
      /<a class="[^"]*after:inset-0[^"]*" href="\/isu\/ISU-ITB-26-0001"[^>]*>Jalan berlubang di Dago<\/a>/,
    )
    expect(html).toContain("Aktivitas terakhir 5 Oktober 2026")
    expect(html).toContain("Coblong, Kota Bandung · 4 laporan")
    expect(html).toContain('<span aria-hidden="true"')
    expect(html).toContain('href="/isu?status=responded"')
    expect(html).not.toContain("Belum ada isu.")
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
