import { join } from "node:path"
import sharp from "sharp"
import { runTool, withScratch } from "./tools.ts"

// Generated test fixtures, never committed

/** Split, scanners stay quiet. */
export function eicar(): Uint8Array {
  return new TextEncoder().encode(
    [
      "X5O!P%@AP[4\\PZX54(P^)7CC)7}$",
      "EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*",
    ].join(""),
  )
}

function buildPdf(objects: string[], trailer = ""): Uint8Array {
  let out = "%PDF-1.4\n"
  const offsets: number[] = []
  objects.forEach((body, i) => {
    offsets.push(out.length)
    out += `${i + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = out.length
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  out += offsets
    .map((o) => `${String(o).padStart(10, "0")} 00000 n \n`)
    .join("")
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R${trailer} >>\nstartxref\n${xref}\n%%EOF\n`
  return new Uint8Array(Buffer.from(out, "latin1"))
}

const RED_BLOCK = "1 0 0 rg 100 400 300 200 re f"

/** Letter pages, red block. */
export function simplePdf(
  pages: number,
  size: [number, number] = [612, 792],
): Uint8Array {
  const kids = Array.from({ length: pages }, (_, i) => `${3 + i * 2} 0 R`)
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pages} >>`,
  ]
  for (let i = 0; i < pages; i++) {
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${size[0]} ${size[1]}] /Contents ${4 + i * 2} 0 R >>`,
    )
    objects.push(
      `<< /Length ${RED_BLOCK.length} >>\nstream\n${RED_BLOCK}\nendstream`,
    )
  }
  return buildPdf(objects)
}

/** Word-like Info and XMP author. */
export function pdfWithMetadata(author: string): Uint8Array {
  const xmp = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>${author}</dc:creator></rdf:Description></rdf:RDF></x:xmpmeta>`
  return buildPdf(
    [
      "<< /Type /Catalog /Pages 2 0 R /Metadata 5 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>",
      `<< /Length ${RED_BLOCK.length} >>\nstream\n${RED_BLOCK}\nendstream`,
      `<< /Type /Metadata /Subtype /XML /Length ${xmp.length} >>\nstream\n${xmp}\nendstream`,
      `<< /Author (${author}) /Creator (Microsoft Word) /Producer (Microsoft Word) >>`,
    ],
    " /Info 6 0 R",
  )
}

/** PDF with an attachment. */
export function pdfWithAttachment(bytes: Uint8Array): Uint8Array {
  const data = Buffer.from(bytes).toString("latin1")
  return buildPdf([
    "<< /Type /Catalog /Pages 2 0 R /Names << /EmbeddedFiles << /Names [(a.com) 5 0 R] >> >> >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>",
    `<< /Length ${RED_BLOCK.length} >>\nstream\n${RED_BLOCK}\nendstream`,
    "<< /Type /Filespec /F (a.com) /EF << /F 6 0 R >> >>",
    `<< /Type /EmbeddedFile /Length ${data.length} >>\nstream\n${data}\nendstream`,
  ])
}

/** Blue PNG, red quarter. */
export function pngFixture(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: "#2050d0" },
  })
    .composite([
      {
        input: {
          create: {
            width: Math.ceil(width / 2),
            height: Math.ceil(height / 2),
            channels: 3,
            background: "#e01010",
          },
        },
        left: 0,
        top: 0,
      },
    ])
    .png()
    .toBuffer()
}

/** heif-enc with x265, media-test image. */
export async function heicFixture(images = 1): Promise<Uint8Array> {
  return withScratch(async (dir) => {
    const inputs: string[] = []
    for (let i = 0; i < images; i++) {
      const path = join(dir, `in-${i}.png`)
      await Bun.write(path, await pngFixture(320 + i * 8, 200))
      inputs.push(path)
    }
    const out = join(dir, "out.heic")
    const run = await runTool(["heif-enc", "-q", "60", "-o", out, ...inputs], {
      timeoutMs: 60_000,
    })
    if (run.exitCode !== 0) throw new Error(`heif-enc failed: ${run.stderr}`)
    return Bun.file(out).bytes()
  })
}

type VideoOptions = {
  width: number
  height: number
  seconds: number
  container?: "mp4" | "webm"
  rotate?: number
}

/** ffmpeg test pattern with tags. */
export async function videoFixture(options: VideoOptions): Promise<Uint8Array> {
  return withScratch(async (dir) => {
    const ext = options.container ?? "mp4"
    const base = join(dir, `base.${ext}`)
    const codec =
      ext === "webm"
        ? ["-c:v", "libvpx", "-b:v", "200k", "-c:a", "libopus"]
        : [
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
          ]
    const encode = await runTool(
      [
        "ffmpeg",
        "-v",
        "error",
        "-nostdin",
        "-y",
        "-f",
        "lavfi",
        "-i",
        `testsrc2=size=${options.width}x${options.height}:rate=5`,
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440",
        "-t",
        String(options.seconds),
        ...codec,
        "-metadata",
        "title=RAHASIA-PELAPOR",
        "-metadata",
        "location=-06.8915+107.6107/",
        base,
      ],
      { timeoutMs: 120_000 },
    )
    if (encode.exitCode !== 0) throw new Error(`ffmpeg: ${encode.stderr}`)
    if (!options.rotate) return Bun.file(base).bytes()
    const rotated = join(dir, `rotated.${ext}`)
    const rotate = await runTool(
      [
        "ffmpeg",
        "-v",
        "error",
        "-nostdin",
        "-y",
        "-display_rotation",
        String(options.rotate),
        "-i",
        base,
        "-c",
        "copy",
        rotated,
      ],
      { timeoutMs: 60_000 },
    )
    if (rotate.exitCode !== 0) throw new Error(`ffmpeg: ${rotate.stderr}`)
    return Bun.file(rotated).bytes()
  })
}
