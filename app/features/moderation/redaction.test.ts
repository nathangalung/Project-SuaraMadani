import { describe, expect, test } from "bun:test"
import { BOX_SCALE } from "../../../shared/evidence.ts"
import { boxPercent, centeredBox, nudgeBox, rectFromDrag } from "./redaction"

const SIZE = { width: 400, height: 200 }

describe("rectFromDrag", () => {
  test("maps rendered pixels to box units either direction", () => {
    expect(rectFromDrag({ x: 100, y: 50 }, { x: 300, y: 150 }, SIZE)).toEqual({
      x: 2500,
      y: 2500,
      w: 5000,
      h: 5000,
    })
    expect(rectFromDrag({ x: 300, y: 150 }, { x: 100, y: 50 }, SIZE)).toEqual({
      x: 2500,
      y: 2500,
      w: 5000,
      h: 5000,
    })
  })

  test("clamps to the image", () => {
    expect(rectFromDrag({ x: -50, y: -10 }, { x: 900, y: 500 }, SIZE)).toEqual({
      x: 0,
      y: 0,
      w: BOX_SCALE,
      h: BOX_SCALE,
    })
  })

  test("a click is no box", () => {
    expect(rectFromDrag({ x: 10, y: 10 }, { x: 11, y: 12 }, SIZE)).toBeNull()
  })
})

describe("nudgeBox", () => {
  const box = {
    page: 0,
    x: 1000,
    y: 1000,
    w: 2000,
    h: 2000,
    style: "fill" as const,
  }

  test("arrows move, stopping at the edge", () => {
    expect(nudgeBox(box, "ArrowRight", false)).toMatchObject({ x: 1100 })
    expect(nudgeBox({ ...box, x: 7950 }, "ArrowRight", false)).toMatchObject({
      x: 8000,
    })
    expect(nudgeBox({ ...box, y: 50 }, "ArrowUp", false)).toMatchObject({
      y: 0,
    })
  })

  test("shift resizes, never below the minimum", () => {
    expect(nudgeBox(box, "ArrowRight", true)).toMatchObject({ w: 2100 })
    expect(nudgeBox({ ...box, h: 150 }, "ArrowUp", true)).toMatchObject({
      h: 100,
    })
    expect(nudgeBox({ ...box, h: 100 }, "ArrowUp", true)).toMatchObject({
      h: 100,
    })
    expect(nudgeBox({ ...box, x: 8000 }, "ArrowRight", true)).toMatchObject({
      w: 2000,
    })
  })
})

describe("helpers", () => {
  test("a new box sits in the centre", () => {
    expect(centeredBox(2, "pixelate")).toEqual({
      page: 2,
      x: 4000,
      y: 4000,
      w: 2000,
      h: 2000,
      style: "pixelate",
    })
  })

  test("percent position for CSS", () => {
    expect(boxPercent({ x: 2500, y: 0, w: 1234, h: BOX_SCALE })).toEqual({
      left: "25%",
      top: "0%",
      width: "12.34%",
      height: "100%",
    })
  })
})
