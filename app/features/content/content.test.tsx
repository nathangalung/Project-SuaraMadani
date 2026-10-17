import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { MemoryRouter } from "react-router"
import { HeroBackdrop, InfoCard, Panel } from "./about-parts"
import { BandTitle, MixedLetters, StripTitle } from "./display-title"
import { PolicyPage } from "./policy-page"
import { updatedOn } from "./prose"

const text = (html: string) => html.replace(/<[^>]+>/g, "")

describe("display titles", () => {
  test("first letter in the body face, rest heading", () => {
    const html = renderToStaticMarkup(
      <MixedLetters text="Cara Kerja dan Metode" />,
    )
    expect(html).toContain(
      '<span class="font-body">C</span><span class="font-heading">ara</span>',
    )
    expect(html).toContain(
      '<span class="font-body">d</span><span class="font-heading">an</span>',
    )
    // Accessible text stays whole
    expect(text(html)).toBe("Cara Kerja dan Metode")
  })

  test("non-letter words stay in the body face", () => {
    const html = renderToStaticMarkup(<MixedLetters text="A & B" />)
    expect(html).toContain('<span class="font-body">&amp;</span>')
    expect(text(html)).toBe("A &amp; B")
  })

  test("glow and partial strip only with KM ITB art", () => {
    const plain = renderToStaticMarkup(
      <StripTitle text="Prinsip" glow={false} />,
    )
    expect(plain).not.toContain("title-glow")
    expect(plain).toContain("top-0")
    expect(plain).toContain("font-bold")
    const km = renderToStaticMarkup(<StripTitle text="Prinsip" glow />)
    expect(km).toContain("title-glow")
    expect(km).toContain("top-[35%]")
    expect(km).toContain("font-normal")
    const band = renderToStaticMarkup(
      <BandTitle id="privasi" text="Privasi" glow={false} />,
    )
    expect(band).toMatch(/^<div class="bg-brand[^"]*"><h2 id="privasi"/)
  })
})

describe("about parts", () => {
  test("default theme loads no KM ITB file", () => {
    const html = renderToStaticMarkup(
      <>
        <HeroBackdrop art={false} />
        <Panel title="Makna Nama" art={false}>
          isi
        </Panel>
        <ul>
          <InfoCard title="Judul" art={false} number={1}>
            isi
          </InfoCard>
        </ul>
      </>,
    )
    expect(html).not.toContain("/km-itb/")
    expect(html).toContain("bg-hero")
    expect(html).toContain("bg-brand-soft")
  })

  test("KM ITB art is decorative and sized", () => {
    const html = renderToStaticMarkup(
      <>
        <HeroBackdrop art />
        <ul>
          <InfoCard title="Judul" art number={2}>
            isi
          </InfoCard>
        </ul>
      </>,
    )
    expect(html).toContain('type="image/avif"')
    expect(html).toContain("/km-itb/about/hero-1440.avif 1440w")
    for (const img of html.match(/<img [^>]*>/g) ?? []) {
      expect(img).toContain('alt=""')
      expect(img).toMatch(/width="\d+" height="\d+"/)
    }
    // Hero art loads eagerly
    expect(html.match(/<img [^>]*hero-720/)?.[0]).not.toContain("lazy")
    // Ordered list carries the number
    expect(html).toContain('<span aria-hidden="true" class="mb-3 grid')
    expect(html).toContain("<h4")
  })

  test("mockup shadows on KM ITB cards and panel only", () => {
    const render = (art: boolean) =>
      renderToStaticMarkup(
        <>
          <Panel title="Makna Nama" art={art}>
            isi
          </Panel>
          <ul>
            <InfoCard title="Judul" art={art}>
              isi
            </InfoCard>
          </ul>
        </>,
      )
    const km = render(true)
    expect(km).toMatch(/<div class="[^"]*shadow-about-panel/)
    expect(km).toMatch(/<li class="[^"]*shadow-about-card/)
    // Mockup cards have no border
    expect(km.match(/<li class="[^"]*"/)?.[0]).not.toContain("border")
    const plain = render(false)
    expect(plain).not.toContain("shadow-")
    expect(plain).toMatch(/<li class="[^"]*border border-line-subtle/)
  })
})

describe("policy page", () => {
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <PolicyPage
        title="Kebijakan Privasi"
        lead="Ringkasan"
        updated="2026-10-14"
        sections={[
          { id: "data", title: "Data", body: <p>a</p> },
          { id: "hak", title: "Hak Anda", body: <p>b</p> },
        ]}
      />
    </MemoryRouter>,
  )

  test("every section has an anchor in the contents", () => {
    for (const id of ["data", "hak"]) {
      expect(html).toContain(`href="#${id}"`)
      expect(html).toContain(`id="${id}"`)
    }
    expect(html).toMatch(/<h1[^>]*>Kebijakan Privasi<\/h1>/)
    expect(html).toContain("Terakhir diperbarui 14 Oktober 2026")
  })

  test("ends with one next step", () => {
    const main = html.slice(html.indexOf('id="hak"'))
    expect(main.match(/<a /g)).toHaveLength(1)
    expect(main).toMatch(/href="\/lapor"[^>]*>Buat laporan<\/a>/)
  })

  test("a fixed date keeps its day in any server zone", () => {
    const zone = process.env.TZ
    try {
      // Extremes catch local-time parsing
      for (const tz of ["Pacific/Kiritimati", "Pacific/Pago_Pago"]) {
        process.env.TZ = tz
        expect([tz, updatedOn("2026-01-01")]).toEqual([tz, "1 Januari 2026"])
      }
    } finally {
      if (zone === undefined) delete process.env.TZ
      else process.env.TZ = zone
    }
  })
})
