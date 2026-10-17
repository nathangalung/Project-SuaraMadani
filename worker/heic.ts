import { readdir } from "node:fs/promises"
import { join } from "node:path"
import { MAX_FULL_DECODE_PIXELS } from "../shared/report-fields.ts"
import { runTool, withScratch } from "./tools.ts"

// Prebuilt sharp lacks HEVC

export class MultiImage extends Error {}
export class ImageTooLarge extends Error {}
class HeifUnreadable extends Error {}

const IMAGE_LINE = /^image: (\d+)x(\d+) \(id=\d+\)/gm

/** Pixels of the biggest image. */
export function largestImage(info: string): number | null {
  let largest: number | null = null
  for (const [, width, height] of info.matchAll(IMAGE_LINE)) {
    largest = Math.max(largest ?? 0, Number(width) * Number(height))
  }
  return largest
}

/** Primary image to PNG. */
export async function decodeHeif(
  input: Uint8Array,
  options: { timeoutMs: number; signal?: AbortSignal; maxPixels?: number },
): Promise<Buffer> {
  return withScratch(async (dir) => {
    const source = join(dir, "in.heic")
    await Bun.write(source, input)
    // Headers only, before decoding
    const info = await runTool(["heif-info", source], options)
    const pixels = largestImage(info.stdout)
    if (info.exitCode !== 0 || pixels === null) {
      throw new HeifUnreadable(info.stderr.slice(0, 200) || "heif-info failed")
    }
    if (pixels > (options.maxPixels ?? MAX_FULL_DECODE_PIXELS)) {
      throw new ImageTooLarge(`${pixels} pixels`)
    }
    // Security limits stay on
    const run = await runTool(
      ["heif-dec", "--quiet", source, join(dir, "out.png")],
      options,
    )
    const names = (await readdir(dir)).filter((name) => name.endsWith(".png"))
    // Several top-level images: out-1.png, out-2.png
    if (names.some((name) => /^out-\d+\.png$/.test(name))) {
      throw new MultiImage("several top-level images")
    }
    if (run.exitCode !== 0 || !names.includes("out.png")) {
      throw new HeifUnreadable(run.stderr.slice(0, 200) || "heif-dec failed")
    }
    return Buffer.from(await Bun.file(join(dir, "out.png")).arrayBuffer())
  })
}
