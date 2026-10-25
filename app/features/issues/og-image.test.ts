import { describe, expect, test } from "bun:test"
import sharp from "sharp"
import {
  type OgCard,
  ogSvg,
  renderOgPng,
  wrapTitle,
} from "./og-image.server.ts"

const card: OgCard = {
  code: "ISU-2026-10-0001",
  title: "Atap ruang kelas SDN 3 Coblong runtuh dan siswa belajar di halaman",
  place: "Kota Bandung",
  label: "Terverifikasi",
  siteName: "Sadar Bersuara · KM ITB",
}

describe("wrapTitle", () => {
  test("breaks on words within the width", () => {
    const lines = wrapTitle(card.title, 28, 4)
    expect(lines.length).toBeGreaterThan(1)
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(28)
    expect(lines.join(" ")).toBe(card.title)
  })

  test("ends with an ellipsis past the last line", () => {
    const lines = wrapTitle("kata ".repeat(60).trim(), 20, 2)
    expect(lines).toHaveLength(2)
    expect(lines[1]?.endsWith("…")).toBe(true)
  })

  test("cuts a single word longer than the width", () => {
    expect(wrapTitle("a".repeat(50), 20, 3)[0]).toHaveLength(20)
  })
})

describe("ogSvg", () => {
  test("escapes markup in every text field", () => {
    const svg = ogSvg({
      ...card,
      title: `</text><script>alert(1)</script> & "x"`,
      place: "<b>",
    })
    expect(svg).not.toContain("<script>")
    expect(svg).not.toContain("<b>")
    expect(svg).toContain("&lt;/text&gt;&lt;script&gt;")
    expect(svg).toContain("&amp;")
  })
})

/** Footer band ink columns. */
async function footerInk(card: OgCard): Promise<{ min: number; max: number }> {
  // SVG loader is blocked elsewhere
  const { data, info } = await sharp(await renderOgPng(card))
    .extract({ left: 0, top: 520, width: 1200, height: 60 })
    .raw()
    .toBuffer({ resolveWithObject: true })
  let min = info.width
  let max = -1
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * info.channels
      // Background is #fff8e5
      if ((data[i] ?? 255) < 200) {
        min = Math.min(min, x)
        max = Math.max(max, x)
      }
    }
  }
  return { min, max }
}

describe("footer line", () => {
  const long = {
    ...card,
    code: "TUN-ITB-26-0004",
    place: "Daerah Khusus Ibukota Jakarta Raya dengan Nama Sangat Panjang",
    detail: "Tuntutan Daerah · 1 dari 3 subtuntutan dipenuhi",
  }

  test("place never reaches the site name", async () => {
    const blank = " ".repeat(card.siteName.length)
    const place = await footerInk({ ...long, siteName: blank })
    const site = await footerInk({ ...long, place: "" })
    expect(place.max).toBeGreaterThan(80)
    expect(place.max).toBeLessThan(site.min - 16)
    expect(ogSvg(long)).toContain("…")
  })

  test("progress sits on its own line", () => {
    const svg = ogSvg(long)
    expect(svg).toMatch(
      /y="510"[^>]*>Tuntutan Daerah · 1 dari 3 subtuntutan dipenuhi</,
    )
  })
})

describe("renderOgPng", () => {
  test("renders a 1200 by 630 PNG with visible text", async () => {
    const png = await renderOgPng(card)
    const image = sharp(png)
    const meta = await image.metadata()
    expect(meta.format).toBe("png")
    expect([meta.width, meta.height]).toEqual([1200, 630])
    // Flat without glyphs
    const stats = await sharp(png)
      .extract({ left: 80, top: 160, width: 1000, height: 300 })
      .stats()
    expect(stats.channels[0]?.stdev ?? 0).toBeGreaterThan(10)
  })
})
