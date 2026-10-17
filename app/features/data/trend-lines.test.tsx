import { describe, expect, test } from "bun:test"
import { renderToString } from "react-dom/server"
import { monotonePath, niceTicks, TrendLines } from "./trend-lines"

const LABELS = [
  { key: "received", label: "Laporan masuk" },
  { key: "verified", label: "Terverifikasi" },
] as const

const months = (values: [number, number][]) =>
  values.map(([received, verified], i) => ({
    month: `2026-${String(i + 1).padStart(2, "0")}`,
    received,
    verified,
  }))

// Control point y values
const controlYs = (path: string) =>
  [...path.matchAll(/C([^C]+)/g)].flatMap(([, args = ""]) =>
    args
      .split(/[ ,]/)
      .filter(Boolean)
      .map(Number)
      .filter((_, i) => i % 2 === 1),
  )

describe("niceTicks", () => {
  test("whole steps from zero past the max", () => {
    expect(niceTicks(7)).toEqual([0, 2, 4, 6, 8])
    expect(niceTicks(120)).toEqual([0, 50, 100, 150])
    expect(niceTicks(3)).toEqual([0, 1, 2, 3])
    expect(niceTicks(1)).toEqual([0, 1])
  })

  test("an empty trend still has an axis", () => {
    expect(niceTicks(0)).toEqual([0, 1])
  })
})

describe("monotonePath", () => {
  test("never overshoots a flat run", () => {
    const path = monotonePath([
      [0, 1000],
      [100, 0],
      [200, 0],
      [300, 1000],
    ])
    expect(path.startsWith("M0,1000C")).toBe(true)
    for (const y of controlYs(path)) {
      expect(y).toBeGreaterThanOrEqual(0)
      expect(y).toBeLessThanOrEqual(1000)
    }
  })

  test("two points draw a line", () => {
    expect(
      monotonePath([
        [0, 10],
        [100, 20],
      ]),
    ).toBe("M0,10L100,20")
  })
})

describe("TrendLines", () => {
  const html = renderToString(
    <TrendLines
      trend={months([
        [3, 1],
        [8, 5],
        [12, 7],
      ])}
      labels={LABELS}
    />,
  )

  test("server renders one path per series", () => {
    expect(html.match(/<path d="M/g)).toHaveLength(2)
    expect(html).toContain('vector-effect="non-scaling-stroke"')
    expect(html).not.toContain("recharts")
  })

  test("last point is labelled directly", () => {
    expect(html).toMatch(/>12<\/span>/)
    expect(html).toMatch(/>7<\/span>/)
  })

  test("is one named image", () => {
    expect(html).toMatch(/role="img" aria-label="[^"]+"/)
  })
})
