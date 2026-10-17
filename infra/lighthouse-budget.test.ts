import { describe, expect, test } from "bun:test"
import { budgetProblems, type Lhr } from "./lighthouse-budget.ts"

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
