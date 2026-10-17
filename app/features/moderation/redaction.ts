import {
  BOX_SCALE,
  type RedactionBox,
  type RedactionStyle,
} from "../../../shared/evidence.ts"

// Editor geometry, unit tested
type Point = { x: number; y: number }
type Size = { width: number; height: number }
type Rect = Pick<RedactionBox, "x" | "y" | "w" | "h">

// 1% steps, 1% minimum
const STEP = 100
const MIN = 100

const clamp = (value: number, low: number, high: number) =>
  Math.min(high, Math.max(low, value))

/** Rendered pixels to box units. */
export function rectFromDrag(a: Point, b: Point, size: Size): Rect | null {
  const unit = (value: number, side: number) =>
    clamp(Math.round((value / side) * BOX_SCALE), 0, BOX_SCALE)
  const x1 = unit(Math.min(a.x, b.x), size.width)
  const x2 = unit(Math.max(a.x, b.x), size.width)
  const y1 = unit(Math.min(a.y, b.y), size.height)
  const y2 = unit(Math.max(a.y, b.y), size.height)
  if (x2 - x1 < MIN || y2 - y1 < MIN) return null
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
}

export type NudgeKey = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown"

export function isNudgeKey(key: string): key is NudgeKey {
  return (
    key === "ArrowLeft" ||
    key === "ArrowRight" ||
    key === "ArrowUp" ||
    key === "ArrowDown"
  )
}

/** Move, or resize with Shift. */
export function nudgeBox(
  box: RedactionBox,
  key: NudgeKey,
  resize: boolean,
): RedactionBox {
  const dx = key === "ArrowLeft" ? -STEP : key === "ArrowRight" ? STEP : 0
  const dy = key === "ArrowUp" ? -STEP : key === "ArrowDown" ? STEP : 0
  if (resize) {
    return {
      ...box,
      w: clamp(box.w + dx, MIN, BOX_SCALE - box.x),
      h: clamp(box.h + dy, MIN, BOX_SCALE - box.y),
    }
  }
  return {
    ...box,
    x: clamp(box.x + dx, 0, BOX_SCALE - box.w),
    y: clamp(box.y + dy, 0, BOX_SCALE - box.h),
  }
}

export function centeredBox(page: number, style: RedactionStyle): RedactionBox {
  return { page, x: 4000, y: 4000, w: 2000, h: 2000, style }
}

/** CSS percentages for overlays. */
export function boxPercent(box: Rect) {
  const pct = (value: number) => `${value / 100}%`
  return {
    left: pct(box.x),
    top: pct(box.y),
    width: pct(box.w),
    height: pct(box.h),
  }
}
