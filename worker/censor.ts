import sharp, { type OverlayOptions } from "sharp"
import {
  boxToPixels,
  pixelBlock,
  type RedactionBox,
} from "../shared/evidence.ts"

// Opaque fill or coarse mosaic
const FILL = { r: 0, g: 0, b: 0 }
const QUALITY = 82

async function mosaic(
  input: Buffer,
  area: { left: number; top: number; width: number; height: number },
): Promise<OverlayOptions> {
  const block = pixelBlock(area)
  // Averaging down, nearest up
  const small = await sharp(input)
    .removeAlpha()
    .extract(area)
    .resize(
      Math.max(1, Math.ceil(area.width / block)),
      Math.max(1, Math.ceil(area.height / block)),
      { fit: "fill", kernel: "cubic" },
    )
    .raw()
    .toBuffer({ resolveWithObject: true })
  const big = await sharp(small.data, {
    raw: { width: small.info.width, height: small.info.height, channels: 3 },
  })
    .resize(area.width, area.height, { fit: "fill", kernel: "nearest" })
    .raw()
    .toBuffer()
  return {
    input: big,
    raw: { width: area.width, height: area.height, channels: 3 },
    left: area.left,
    top: area.top,
  }
}

/** Boxes burned in, metadata gone. */
export async function censorImage(
  input: Buffer,
  boxes: RedactionBox[],
): Promise<{ buffer: Buffer; width: number; height: number }> {
  const meta = await sharp(input).metadata()
  const size = { width: meta.width ?? 0, height: meta.height ?? 0 }
  if (!size.width || !size.height) throw new Error("image has no size")
  const overlays: OverlayOptions[] = []
  for (const box of boxes) {
    const area = boxToPixels(box, size)
    overlays.push(
      box.style === "fill"
        ? {
            input: {
              create: {
                width: area.width,
                height: area.height,
                channels: 3,
                background: FILL,
              },
            },
            left: area.left,
            top: area.top,
          }
        : await mosaic(input, area),
    )
  }
  const buffer = await sharp(input)
    .removeAlpha()
    .composite(overlays)
    .webp({ quality: QUALITY })
    .toBuffer()
  return { buffer, ...size }
}
