import { join } from "node:path"
import { runTool, withScratch } from "./tools.ts"

// Public PDF is page images

export class PdfUnreadable extends Error {}

// Starting Values: 10 pages
const MAX_PDF_PAGES = 10
const DPI = 150
const MAX_SIDE_PX = 2560
const PAGE_SIZE = /^Page\s+(\d+) size:\s+([\d.]+) x ([\d.]+) pts/gm

type PdfInfo = { pages: number; sizes: Map<number, number> }

function parseInfo(text: string): PdfInfo | null {
  const pages = Number(/^Pages:\s+(\d+)$/m.exec(text)?.[1])
  if (!Number.isInteger(pages) || pages < 1) return null
  const sizes = new Map<number, number>()
  for (const match of text.matchAll(PAGE_SIZE)) {
    sizes.set(Number(match[1]), Math.max(Number(match[2]), Number(match[3])))
  }
  return { pages, sizes }
}

/** Long side at most 2560. */
function dpiFor(longSidePts: number | undefined): number {
  if (!longSidePts) return DPI
  return Math.max(
    1,
    Math.min(DPI, Math.floor((MAX_SIDE_PX * 72) / longSidePts)),
  )
}

// qpdf: 0 ok, 3 warnings
const QPDF_WROTE = new Set([0, 3])

/** Info and XMP removed. */
export async function stripPdfMetadata(
  input: Uint8Array,
  options: { timeoutMs: number; signal?: AbortSignal },
): Promise<Uint8Array | null> {
  return withScratch(async (dir) => {
    const source = join(dir, "in.pdf")
    const target = join(dir, "out.pdf")
    await Bun.write(source, input)
    const run = await runTool(
      ["qpdf", "--remove-info", "--remove-metadata", source, target],
      options,
    )
    const file = Bun.file(target)
    if (!QPDF_WROTE.has(run.exitCode) || !(await file.exists())) return null
    return file.bytes()
  })
}

/** pdftoppm per page, one deadline. */
export async function rasterizePdf(
  input: Uint8Array,
  options: { timeoutMs: number; signal?: AbortSignal },
): Promise<{ pages: Buffer[]; sourcePages: number }> {
  const deadline = Date.now() + options.timeoutMs
  const left = () => Math.max(1, deadline - Date.now())
  return withScratch(async (dir) => {
    const source = join(dir, "in.pdf")
    await Bun.write(source, input)
    const info = await runTool(
      ["pdfinfo", "-f", "1", "-l", String(MAX_PDF_PAGES), source],
      { timeoutMs: left(), signal: options.signal },
    )
    const parsed = info.exitCode === 0 ? parseInfo(info.stdout) : null
    if (!parsed) throw new PdfUnreadable("pdfinfo failed")
    const count = Math.min(parsed.pages, MAX_PDF_PAGES)
    const pages: Buffer[] = []
    for (let page = 1; page <= count; page++) {
      const prefix = join(dir, `p${page}`)
      const run = await runTool(
        [
          "pdftoppm",
          "-f",
          String(page),
          "-l",
          String(page),
          "-r",
          String(dpiFor(parsed.sizes.get(page))),
          "-png",
          "-singlefile",
          source,
          prefix,
        ],
        { timeoutMs: left(), signal: options.signal },
      )
      const file = Bun.file(`${prefix}.png`)
      if (run.exitCode !== 0 || !(await file.exists())) {
        throw new PdfUnreadable(`pdftoppm failed on page ${page}`)
      }
      pages.push(Buffer.from(await file.arrayBuffer()))
    }
    return { pages, sourcePages: parsed.pages }
  })
}
