import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  budgetProblems,
  byPage,
  cpuMultiplier,
  type Lhr,
  main,
  medianReport,
} from "./lighthouse-budget.ts"

function lhr(values: {
  url?: string
  lcp?: number
  tbt?: number
  cls?: number
  image?: number
  font?: number
  html?: number
}): Lhr {
  return {
    finalDisplayedUrl: values.url ?? "http://itb.localhost/",
    audits: {
      "largest-contentful-paint": { numericValue: values.lcp ?? 1200 },
      "total-blocking-time": { numericValue: values.tbt ?? 10 },
      "cumulative-layout-shift": { numericValue: values.cls ?? 0.01 },
      "network-requests": {
        details: {
          items: [
            { resourceType: "Document", transferSize: values.html ?? 9000 },
            { resourceType: "Image", transferSize: values.image ?? 20_000 },
            { resourceType: "Font", transferSize: values.font ?? 80_000 },
            { resourceType: "Script", transferSize: 400_000 },
          ],
        },
      },
    },
  }
}

describe("PLAN §10.8 lab budgets", () => {
  test("a page inside every budget passes", () => {
    expect(budgetProblems(lhr({}))).toEqual([])
  })

  test("LCP, TBT and CLS over target fail", () => {
    expect(budgetProblems(lhr({ lcp: 2600, tbt: 60, cls: 0.06 }))).toEqual([
      "/: LCP 2600 ms > 2500",
      "/: TBT 60 ms > 50",
      "/: CLS 0.06 > 0.05",
    ])
  })

  test("images plus fonts share 150 kB", () => {
    expect(budgetProblems(lhr({ image: 80_000, font: 80_000 }))).toEqual([
      "/: images and fonts 156.3 kB > 150",
    ])
  })

  test("/data gets 60 kB of HTML, others 30", () => {
    expect(budgetProblems(lhr({ html: 40_000 }))).toEqual([
      "/: HTML 39.1 kB > 30",
    ])
    expect(
      budgetProblems(lhr({ url: "http://itb.localhost/data", html: 40_000 })),
    ).toEqual([])
  })
})

// Lighthouse docs/throttling.md, mid-tier target
describe("CPU slowdown calibrated to the host", () => {
  test("bracket centres keep the suggested values", () => {
    expect(cpuMultiplier(460)).toBe(1)
    expect(cpuMultiplier(1250)).toBe(2)
    expect(cpuMultiplier(1750)).toBe(4)
  })

  test("no cliff between brackets", () => {
    expect(cpuMultiplier(1499)).toBeCloseTo(cpuMultiplier(1501), 1)
    expect(cpuMultiplier(1588)).toBeCloseTo(3.35, 2)
  })

  test("clamped to 1x and 4x", () => {
    expect(cpuMultiplier(100)).toBe(1)
    expect(cpuMultiplier(2900)).toBe(4)
  })

  test("a report without an index is refused", () => {
    expect(() => cpuMultiplier(Number.NaN)).toThrow()
  })
})

// Lighthouse CI default: 3 runs
describe("median of runs per page", () => {
  test("each metric takes its own median", () => {
    const runs = [
      lhr({ tbt: 90, lcp: 1000 }),
      lhr({ tbt: 20, lcp: 3000 }),
      lhr({ tbt: 40, lcp: 2000 }),
    ]
    expect(budgetProblems(medianReport(runs))).toEqual([])
  })

  test("pages are grouped by URL", () => {
    const reports = [
      lhr({ tbt: 90 }),
      lhr({ url: "http://itb.localhost/isu", tbt: 90 }),
      lhr({ tbt: 10 }),
      lhr({ url: "http://itb.localhost/isu", tbt: 80 }),
      lhr({ tbt: 10 }),
      lhr({ url: "http://itb.localhost/isu", tbt: 70 }),
    ]
    expect(byPage(reports).flatMap(budgetProblems)).toEqual([
      "/isu: TBT 80 ms > 50",
    ])
  })
})

describe("bun lighthouse-budget.ts", () => {
  let dir = ""

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "lighthouse-budget-"))
  })

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  async function write(name: string, report: Lhr): Promise<string> {
    const path = join(dir, name)
    await Bun.write(path, JSON.stringify(report))
    return path
  }

  async function run(argv: string[]) {
    const out = spyOn(console, "log").mockImplementation(() => {})
    const err = spyOn(console, "error").mockImplementation(() => {})
    try {
      const code = await main(argv)
      return {
        code,
        out: out.mock.calls.map(([line]) => String(line)),
        err: err.mock.calls.map(([line]) => String(line)),
      }
    } finally {
      out.mockRestore()
      err.mockRestore()
    }
  }

  test("Given a calibration run, when --multiplier reads it, then it prints the slowdown and the index", async () => {
    const path = await write("calibrate.json", {
      ...lhr({}),
      environment: { benchmarkIndex: 1250.4 },
    })
    expect(await run(["--multiplier", path])).toEqual({
      code: 0,
      out: ["2 1250"],
      err: [],
    })
  })

  test("Given three runs per page, when one page is over budget, then it names it and exits 1", async () => {
    const paths = await Promise.all(
      [90, 80, 70].map((tbt, i) =>
        write(`isu-${i}.json`, lhr({ url: "http://itb.localhost/isu", tbt })),
      ),
    )
    paths.push(await write("home.json", lhr({})))
    expect(await run(paths)).toEqual({
      code: 1,
      out: [JSON.stringify({ msg: "lighthouse-budget", problems: 1 })],
      err: ["/isu: TBT 80 ms > 50"],
    })
  })

  test("Given pages within budget, then it exits 0", async () => {
    const path = await write("ok.json", lhr({}))
    expect((await run([path])).code).toBe(0)
  })
})
