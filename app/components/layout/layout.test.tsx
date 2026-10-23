import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { MemoryRouter } from "react-router"
import { brandImages } from "./brand-assets"
import { errorText } from "./error-page"
import { Footer } from "./footer"
import { Header, hasPageSignIn, isAuthShell, syncMenuTop } from "./header"
import { IntakeBanner } from "./intake-banner"
import { PageHeader } from "./page-header"
import { SectionHeading } from "./section-heading"
import { ownsDescription, SiteMeta } from "./site-meta"
import { SkipLink } from "./skip-link"

const nav = [
  { to: "/", label: "Beranda" },
  { to: "/lapor", label: "Lapor" },
  { to: "/isu", label: "Jelajah" },
]

function renderAt(path: string, node: React.ReactNode): string {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[path]}>{node}</MemoryRouter>,
  )
}

describe("IntakeBanner", () => {
  test("names the pause and keeps reading open", () => {
    const html = renderToStaticMarkup(<IntakeBanner />)
    expect(html).toMatch(/^<section aria-label="Pemberitahuan layanan"/)
    expect(html).toContain("Pelaporan sedang dihentikan sementara.")
    expect(html).not.toContain("<a ")
  })

  test("links the public status page when set", () => {
    const html = renderToStaticMarkup(
      <IntakeBanner statusHref="https://status.contoh.id/" />,
    )
    expect(html).toContain('href="https://status.contoh.id/"')
    expect(html).toContain("Lihat status layanan")
  })
})

describe("Header", () => {
  test("home link name contains the visible site name", () => {
    const html = renderAt(
      "/isu",
      <Header siteName="Sadar Bersuara" nav={nav} user={null} />,
    )
    expect(html).not.toMatch(/<a[^>]*aria-label/)
    // Tenant line dropped 21 Oct
    expect(html).toMatch(
      /<a[^>]*href="\/"[^>]*><span[^>]*><img[^>]*alt=""[^>]*\/><\/span><span[^>]*>Sadar Bersuara<\/span><\/a>/,
    )
  })

  test("KM ITB logo morphs from the plain hand", () => {
    const km = brandImages("km-itb")
    const html = renderAt(
      "/",
      <Header siteName="Sadar Bersuara" nav={nav} user={null} {...km} />,
    )
    expect(html).toMatch(
      /<img src="\/km-itb\/logo-tangan.webp"[^>]*\/><img src="\/km-itb\/logo-tangan-polos.webp" alt=""[^>]*class="logo-intro absolute inset-0/,
    )
    const plain = renderAt(
      "/",
      <Header siteName="Sadar Bersuara" nav={nav} user={null} />,
    )
    expect(plain).not.toContain("logo-intro")
  })

  test("KM ITB emblem sits after the hand", () => {
    const km = brandImages("km-itb")
    const html = renderAt(
      "/",
      <Header siteName="Sadar Bersuara" nav={nav} user={null} {...km} />,
    )
    // Link name stays visible text
    expect(html).toMatch(
      /<\/span><img src="\/km-itb\/logo-km.webp" alt=""[^>]*srcSet="\/km-itb\/logo-km.webp 2x, \/km-itb\/logo-km-168.webp 3x"[^>]*max-\[359px\]:hidden"\/><span[^>]*>Sadar Bersuara<\/span><\/a>/,
    )
  })

  test("sticks to the top, static on short screens", () => {
    const html = renderAt(
      "/",
      <Header siteName="Sadar Bersuara" nav={nav} user={null} />,
    )
    expect(html).toContain('<header class="header-bg sticky top-0 z-[1000]')
    expect(html).toContain("[@media(max-height:30rem)]:static")
  })

  test("signed out offers only Masuk", () => {
    const html = renderAt(
      "/",
      <Header siteName="Sadar Bersuara" nav={nav} user={null} />,
    )
    expect(html.match(/href="\/masuk"/g)).toHaveLength(2)
    expect(html).not.toMatch(/Daftar|Buat akun|href="\/lacak"/)
  })

  test("pages with their own sign-in drop Masuk", () => {
    const html = renderAt(
      "/lacak",
      <Header
        siteName="Sadar Bersuara"
        nav={nav}
        user={null}
        showSignIn={false}
      />,
    )
    expect(html).not.toContain('href="/masuk"')
    expect(html).toContain('href="/isu"')
    // No empty account list
    expect(html).not.toMatch(/<ul[^>]*><\/ul>/)
    expect(hasPageSignIn({ pageSignIn: true })).toBe(true)
    expect(hasPageSignIn({})).toBe(false)
    expect(hasPageSignIn(undefined)).toBe(false)
  })

  test("menu toggle is named and swaps icons", () => {
    const html = renderAt(
      "/",
      <Header siteName="Sadar Bersuara" nav={nav} user={null} />,
    )
    const summary = html.match(/<summary[^>]*>(.*?)<\/summary>/)?.[1] ?? ""
    expect(summary).toContain('<span class="sr-only">Menu</span>')
    expect(summary).toContain("group-open:hidden")
    expect(summary).toContain("group-open:block")
  })

  test("auth shell shows the logo only", () => {
    const html = renderAt(
      "/masuk",
      <Header siteName="Sadar Bersuara" nav={nav} user={null} variant="auth" />,
    )
    expect(html).toContain("Sadar Bersuara")
    expect(html).not.toMatch(/<nav|<details|sticky|href="\/masuk"/)
    expect(isAuthShell({ shell: "auth" })).toBe(true)
    expect(isAuthShell({})).toBe(false)
    expect(isAuthShell(undefined)).toBe(false)
  })

  test("marks the current page and works without JS", () => {
    const html = renderAt(
      "/isu",
      <Header siteName="Sadar Bersuara" nav={nav} user={null} />,
    )
    expect(html).toMatch(
      /<a[^>]*aria-current="page"[^>]*href="\/isu"|<a[^>]*href="\/isu"[^>]*aria-current="page"/,
    )
    expect(html).toContain("<details")
    expect(html).toContain('href="/masuk"')
  })

  test("signed-in user gets a sign-out form and draft link", () => {
    const html = renderAt(
      "/",
      <Header
        siteName="Sadar Bersuara"
        nav={nav}
        user={{ email: "warga@contoh.com" }}
        draftHref="/lapor/periksa"
        signOutAction="/keluar"
      />,
    )
    expect(html).toContain("warga@contoh.com")
    expect(html).toMatch(
      /<form[^>]*method="post"[^>]*action="\/keluar"|<form[^>]*action="\/keluar"[^>]*method="post"/,
    )
    expect(html).toContain("Lanjutkan draf laporan")
    // Grid column grows, never wraps
    expect(html).toMatch(/class="whitespace-nowrap[^"]*text-accent/)
    expect(html).not.toContain('href="/masuk"')
  })

  test("account menu holds Laporan saya and Keluar", () => {
    const html = renderAt(
      "/",
      <Header
        siteName="Sadar Bersuara"
        nav={nav}
        user={{ email: "warga@contoh.com" }}
      />,
    )
    const account = html.match(
      /<details class="group relative">(.*?)<\/details>/,
    )?.[1]
    expect(account).toContain('<span class="sr-only">Menu akun: </span>')
    expect(account).toContain('title="Masuk sebagai warga@contoh.com"')
    expect(account).toMatch(/href="\/lacak"[^>]*>Laporan saya</)
    expect(account).toContain(">Keluar</button>")
    expect(html.match(/>Laporan saya</g)).toHaveLength(2)
    expect(html.match(/>Keluar</g)).toHaveLength(2)
    expect(account).toContain("transition-transform duration-(--dur-hover)")
  })

  test("desktop nav is centred, state never moves it", () => {
    const html = renderAt(
      "/",
      <Header siteName="Sadar Bersuara" nav={nav} user={null} />,
    )
    expect(html).toContain("xl:grid xl:grid-cols-[1fr_auto_1fr]")
    expect(html).toMatch(
      /<a[^>]*class="[^"]*justify-self-start[^"]*"[^>]*href="\/"/,
    )
    expect(html).toMatch(/<nav[^>]*class="[^"]*justify-self-center/)
    expect(html).toMatch(/<div class="[^"]*justify-self-end[^"]*xl:flex/)
  })

  test("nav star marks only the active item", () => {
    const km = brandImages("km-itb")
    const html = renderAt(
      "/isu",
      <Header siteName="Sadar Bersuara" nav={nav} user={null} {...km} />,
    )
    expect(html.match(/navlink-star/g)).toHaveLength(1)
    const active = html.match(
      /<a[^>]*aria-current="page"[^>]*href="\/isu"[^>]*>(.*?)<\/a>/,
    )?.[1]
    expect(active).toContain('src="/km-itb/navlink-star.webp"')
    expect(active).toContain('alt=""')
    // Marker stops before the star
    expect(active).toContain("bg-highlight right-4")
    expect(active).toContain("relative -mt-2 w-[11px]")
    expect(active).toContain("select-none")
    expect(html).toMatch(/<img src="\/km-itb\/logo-tangan.webp" alt=""/)
    // 3x phones get 168px
    expect(html).toContain(
      'srcSet="/km-itb/logo-tangan.webp 2x, /km-itb/logo-tangan-168.webp 3x"',
    )
  })

  test("default set has no KM ITB file", () => {
    const html = renderAt(
      "/isu",
      <Header
        siteName="Sadar Bersuara"
        nav={nav}
        user={null}
        {...brandImages(null)}
      />,
    )
    expect(html).not.toContain("/km-itb/")
    expect(html).toContain("bg-highlight right-0")
    expect(html).toContain('src="/logo.svg"')
    expect(html).not.toContain("srcSet")
    expect(brandImages(undefined)).toEqual({ logoSrc: "/logo.svg" })
  })

  test("mobile panel height starts at its own top", () => {
    const html = renderAt(
      "/",
      <Header siteName="Sadar Bersuara" nav={nav} user={null} />,
    )
    expect(html).toContain("max-h-[calc(100svh-var(--menu-top,5rem))]")
    expect(html).toContain("lg:max-h-[calc(100svh-var(--menu-top,6rem))]")
    const set = new Map<string, string>()
    const panel = {
      getBoundingClientRect: () => ({ top: 139.6 }),
      style: {
        setProperty: (name: string, value: string) => {
          set.set(name, value)
        },
      },
    }
    syncMenuTop(panel)
    expect(set.get("--menu-top")).toBe("140px")
    syncMenuTop(null)
  })
})

describe("Footer", () => {
  test("shows the identifier and policy links", () => {
    const html = renderAt(
      "/",
      <Footer
        siteName="Sadar Bersuara"
        year={2026}
        contactEmail="kontak@contoh.id"
        operator="Perkumpulan Sadar Bersuara"
        alliance="Aliansi Kampus"
        legalNumber="AHU-0000000.AH.01.07.TAHUN 2026"
        links={[{ to: "/privasi", label: "Privasi" }]}
        statusHref="https://status.contoh.id"
      />,
    )
    // Managed-by line dropped 21 Oct
    expect(html).not.toContain("Dikelola")
    expect(html).toContain("Anggota aliansi Aliansi Kampus")
    expect(html).toContain("Nomor badan hukum: AHU-0000000.AH.01.07.TAHUN 2026")
    expect(html).toContain('href="/privasi"')
    expect(html).toContain('href="https://status.contoh.id"')
    expect(html).toContain('href="mailto:kontak@contoh.id"')
    expect(html).toContain("© 2026 Perkumpulan Sadar Bersuara")
    expect(html).toContain('<nav aria-label="Tautan situs">')
    // Emblem centred beside the text
    expect(html).toContain('class="flex items-center gap-4"><img')
  })

  test("uses the footer gradient and no top rule", () => {
    const html = renderAt(
      "/",
      <Footer
        siteName="Sadar Bersuara"
        year={2026}
        operator="KM ITB"
        links={[]}
      />,
    )
    expect(html).toMatch(/^<footer class="bg-footer text-ink">/)
    expect(html).toContain('src="/logo.svg"')
    expect(html).not.toContain("mailto:")
    expect(html).toContain("Sadar Bersuara")
  })

  test("KM ITB logo loads lazily", () => {
    const km = brandImages("km-itb")
    const html = renderAt(
      "/",
      <Footer
        siteName="Sadar Bersuara"
        year={2026}
        operator="KM ITB"
        links={[]}
        logoSrc={km.logoSrc}
        logoSrcSet={km.logoSrcSet}
        emblemSrc={km.emblemSrc}
        emblemSrcSet={km.emblemSrcSet}
      />,
    )
    expect(html).toMatch(
      /<img src="\/km-itb\/logo-tangan.webp" alt="" width="56" height="56" srcSet="[^"]*logo-tangan-168.webp 3x" loading="lazy"[^>]*\/><img src="\/km-itb\/logo-km.webp" alt="" width="56" height="56" srcSet="[^"]*logo-km-168.webp 3x" loading="lazy"/,
    )
  })

  test("policy links sit in the legal row", () => {
    const html = renderAt(
      "/",
      <Footer
        siteName="Sadar Bersuara"
        year={2026}
        operator="KM ITB"
        links={[]}
        policyLinks={[{ to: "/privasi", label: "Kebijakan privasi" }]}
      />,
    )
    const legal = html.slice(html.indexOf("© 2026 KM ITB"))
    expect(legal).toMatch(
      /^© 2026 KM ITB<\/p><nav aria-label="Kebijakan"><ul[^>]*><li><a[^>]*href="\/privasi"/,
    )
  })

  test("omits the links landmark when it has no links", () => {
    const html = renderAt(
      "/",
      <Footer
        siteName="Sadar Bersuara"
        year={2026}
        operator="KM ITB"
        links={[]}
      />,
    )
    expect(html).toContain("© 2026 KM ITB")
    expect(html).not.toContain("<nav")
  })
})

describe("Headings", () => {
  test("page header is the H1", () => {
    const html = renderToStaticMarkup(
      <PageHeader title="Isu di Daerah Anda" description="Ringkasan" />,
    )
    expect(html).toMatch(/<h1[^>]*>Isu di Daerah Anda<\/h1>/)
  })

  test("band header is the brand strip", () => {
    const html = renderToStaticMarkup(
      <PageHeader title="Isu Tidak Ditemukan" variant="band" />,
    )
    expect(html).toMatch(/^<div class="bg-brand[^"]*text-on-accent/)
    expect(html).not.toContain("header-bg")
  })

  test("section heading is an H2 and visible before JS", () => {
    const html = renderToStaticMarkup(
      <SectionHeading id="baru" title="Baru Ditanggapi Instansi" />,
    )
    expect(html).toMatch(
      /<h2[^>]*id="baru"[^>]*>Baru Ditanggapi Instansi<\/h2>/,
    )
    expect(html).not.toContain("reveal")
  })
})

describe("SkipLink", () => {
  test("jumps to the main content", () => {
    const html = renderToStaticMarkup(<SkipLink />)
    expect(html).toMatch(/^<a href="#konten"[^>]*>Lewati ke konten<\/a>$/)
    // not-sr-only resets the padding
    expect(html).not.toContain("sr-only")
    // Above the sticky header
    expect(html).toContain("z-[2000]")
  })

  test("root renders it first and owns the only main", async () => {
    const root = await Bun.file(
      new URL("../../root.tsx", import.meta.url),
    ).text()
    expect(root).toMatch(/<body[^>]*>\s*<SkipLink \/>/)
    expect(root).toMatch(
      /<main\s+id="konten"\s+tabIndex=\{-1\}\s+className=\{`flex-1 outline-none /,
    )
    // S15: footer never floats up
    expect(root).toContain('<div className="flex min-h-svh flex-col">')
    const glob = new Bun.Glob("{routes,features}/**/*.tsx")
    const appDir = new URL("../../", import.meta.url).pathname
    for await (const file of glob.scan(appDir)) {
      const source = await Bun.file(`${appDir}${file}`).text()
      expect({ file, main: source.includes("<main") }).toEqual({
        file,
        main: false,
      })
    }
  })
})

describe("SiteMeta", () => {
  test("sets theme colour and the site description", () => {
    const html = renderToStaticMarkup(
      <SiteMeta siteName="KM ITB" themeColor="#08266e" withDescription />,
    )
    expect(html).toContain('<meta name="theme-color" content="#08266e"/>')
    expect(html).toMatch(/<meta name="description" content="[^"]*KM ITB/)
  })

  test("leaves the description to pages that set one", () => {
    const html = renderToStaticMarkup(
      <SiteMeta
        siteName="KM ITB"
        themeColor="#08266e"
        withDescription={false}
      />,
    )
    expect(html).not.toContain('name="description"')
  })

  test("preloads the heading font when given", () => {
    const html = renderToStaticMarkup(
      <SiteMeta
        siteName="KM ITB"
        themeColor="#08266e"
        withDescription
        headingFontUrl="/assets/tilt-warp-latin-400-abc.woff2"
      />,
    )
    expect(html).toContain(
      '<link rel="preload" href="/assets/tilt-warp-latin-400-abc.woff2" as="font" type="font/woff2" crossorigin="anonymous"/>',
    )
    const plain = renderToStaticMarkup(
      <SiteMeta siteName="KM ITB" themeColor="#08266e" withDescription />,
    )
    expect(plain).not.toContain("preload")
  })

  test("reads the page handle", () => {
    expect(ownsDescription({ ownDescription: true })).toBe(true)
    expect(ownsDescription({})).toBe(false)
    expect(ownsDescription(undefined)).toBe(false)
  })
})

describe("errorText", () => {
  test("a signed-in 403 never offers Masuk", () => {
    expect(errorText(403, false, false).next?.to).toBe("/masuk")
    expect(errorText(403, true, true).next).toEqual({
      to: "/masuk/dua-langkah",
      label: "Verifikasi dua langkah",
    })
    const member = errorText(403, true, false)
    expect(member.next).toBeUndefined()
    expect(member.body).not.toContain("Masuk dengan")
  })

  test("403 copy fits both /kelola and /admin", () => {
    // A tenant admin on /admin
    for (const text of [
      errorText(403, true, false).body,
      errorText(403, false, false).body,
    ]) {
      expect(text).not.toMatch(/terdaftar sebagai admin|hanya untuk admin/)
    }
  })

  test("404 points to the issues, others home only", () => {
    expect(errorText(404, true, false).next?.to).toBe("/isu")
    expect(errorText(500, false, false).next).toBeUndefined()
  })
})
