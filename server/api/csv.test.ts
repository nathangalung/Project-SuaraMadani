import { describe, expect, test } from "bun:test"
import { toCsv } from "./csv.ts"

describe("toCsv", () => {
  test("header line, CRLF records, empty cell for null", () => {
    expect(
      toCsv(
        ["month", "received"],
        [
          { month: "2026-09", received: 11 },
          { month: "2026-10", received: null },
        ],
      ),
    ).toBe("month,received\r\n2026-09,11\r\n2026-10,\r\n")
  })

  test("quotes commas, quotes and line breaks (RFC 4180)", () => {
    expect(toCsv(["agency"], [{ agency: 'Dinas "PU", Kota\nBandung' }])).toBe(
      'agency\r\n"Dinas ""PU"", Kota\nBandung"\r\n',
    )
  })

  test("text that a spreadsheet would run gets a quote prefix", () => {
    const rows = ["=1+1", "+62", "-x", "@SUM(A1)", "\tx", "\rx", "＝1"].map(
      (agency) => ({ agency }),
    )
    const lines = toCsv(["agency"], rows).split("\r\n").slice(1, -1)
    expect(lines).toEqual([
      "'=1+1",
      "'+62",
      "'-x",
      "'@SUM(A1)",
      "'\tx",
      '"\'\rx"',
      "'＝1",
    ])
  })

  test("a semicolon list separator cannot start a formula cell", () => {
    // Excel id-ID splits on semicolons
    const cases: [string, string][] = [
      ["a;=1+1", `"a;'=1+1"`],
      ["Dinas PU;+1+cmd", `"Dinas PU;'+1+cmd"`],
      ["x;-y", `"x;'-y"`],
      ["x;@SUM(A1)", `"x;'@SUM(A1)"`],
      ["x;\t=1", `"x;'\t=1"`],
      ["x;＝1", `"x;'＝1"`],
      ['x;"=1"', `"x;'""=1"""`],
      ["a\n=1", `"a\n'=1"`],
      ["a\r\n+1", `"a\r\n'+1"`],
      ["Jalan; -1", '"Jalan; -1"'],
    ]
    for (const [title, cell] of cases) {
      expect(toCsv(["title"], [{ title }])).toBe(`title\r\n${cell}\r\n`)
    }
  })

  test("a value after a comma inside a quoted cell is unchanged", () => {
    expect(toCsv(["price"], [{ price: "Rp10.000,-" }])).toBe(
      'price\r\n"Rp10.000,-"\r\n',
    )
  })

  test("numbers are never prefixed", () => {
    expect(toCsv(["n", "share"], [{ n: -1, share: 0.625 }])).toBe(
      "n,share\r\n-1,0.625\r\n",
    )
  })

  test("columns keep the given order", () => {
    expect(toCsv(["b", "a"], [{ a: 1, b: 2 }])).toBe("b,a\r\n2,1\r\n")
  })
})
