import sharp from "sharp"
import { createSlots } from "./slots.ts"

// Starting Values: two renders
const renderSlots = createSlots(2)

const WIDTH = 1200
const HEIGHT = 630
const TITLE_WIDTH = 26
const TITLE_LINES = 4
// Wide glyph widths, footer fonts
const PLACE_CHAR_PX = 19
const SITE_CHAR_PX = 20
const DETAIL_CHARS = 58
const GAP_PX = 48

export type OgCard = {
  code: string
  title: string
  place: string
  // Own line above the footer
  detail?: string
  label: string
  siteName: string
}

const ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ENTITIES[char] ?? char)
}

/** Word wrap, ellipsis on overflow. */
export function wrapTitle(
  title: string,
  width: number,
  maxLines: number,
): string[] {
  const lines: string[] = []
  let line = ""
  for (const raw of title.split(/\s+/).filter(Boolean)) {
    const word = raw.slice(0, width)
    const candidate = line ? `${line} ${word}` : word
    if (candidate.length <= width) {
      line = candidate
      continue
    }
    lines.push(line)
    line = word
  }
  if (line) lines.push(line)
  if (lines.length <= maxLines) return lines
  const kept = lines.slice(0, maxLines)
  const last = kept[maxLines - 1] ?? ""
  kept[maxLines - 1] = `${last.slice(0, width - 1)}…`
  return kept
}

/** One line, ellipsis past max. */
function fitLine(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`
}

/** Room left of siteName. */
function placeChars(siteName: string): number {
  const free = WIDTH - 160 - GAP_PX - siteName.length * SITE_CHAR_PX
  return Math.max(0, Math.floor(free / PLACE_CHAR_PX))
}

/** Trusted template, every field escaped. */
export function ogSvg(card: OgCard): string {
  const title = wrapTitle(card.title, TITLE_WIDTH, TITLE_LINES)
    .map(
      (line, i) =>
        `<text x="80" y="${230 + i * 76}" font-size="64" font-weight="700" fill="#08266e">${escapeXml(line)}</text>`,
    )
    .join("")
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" font-family="Noto Sans, DejaVu Sans, sans-serif">
<rect width="${WIDTH}" height="${HEIGHT}" fill="#fff8e5"/>
<rect width="${WIDTH}" height="16" fill="#0f55d6"/>
<text x="80" y="110" font-size="34" font-weight="700" fill="#0f55d6">${escapeXml(card.code)}</text>
<text x="${WIDTH - 80}" y="110" font-size="30" text-anchor="end" fill="#4a5578">${escapeXml(card.label)}</text>
${title}
${card.detail ? `<text x="80" y="510" font-size="30" fill="#4a5578">${escapeXml(fitLine(card.detail, DETAIL_CHARS))}</text>` : ""}
<text x="80" y="560" font-size="32" fill="#4a5578">${escapeXml(fitLine(card.place, placeChars(card.siteName)))}</text>
<text x="${WIDTH - 80}" y="560" font-size="30" font-weight="700" text-anchor="end" fill="#08266e">${escapeXml(card.siteName)}</text>
</svg>`
}

/** Web only, unblocks SVG loader. */
export function renderOgPng(card: OgCard): Promise<Uint8Array<ArrayBuffer>> {
  return renderSlots.run(async () => {
    sharp.unblock({ operation: ["VipsForeignLoadSvgBuffer"] })
    const buffer = await sharp(Buffer.from(ogSvg(card)))
      .png({ compressionLevel: 9 })
      .toBuffer()
    return new Uint8Array(buffer)
  })
}
