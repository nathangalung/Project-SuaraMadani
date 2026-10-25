import { describe, expect, test } from "bun:test"
import {
  canonicalizeSearch,
  DATA_QUERY,
  DEMAND_LIST_QUERY,
  ISSUE_LIST_QUERY,
  pageNumber,
  querySpecFor,
  readQuery,
} from "./canonical-query.ts"

const list = ISSUE_LIST_QUERY

describe("canonicalizeSearch", () => {
  test("strips tracking parameters", () => {
    expect(canonicalizeSearch("?fbclid=abc&utm_source=x", {})).toEqual({
      search: "",
      changed: true,
    })
  })

  test("empty query is already canonical", () => {
    expect(canonicalizeSearch("", list)).toEqual({ search: "", changed: false })
  })

  test("sorts keys", () => {
    expect(
      canonicalizeSearch("?wilayah=32.73&kategori=bansos", list).search,
    ).toBe("?kategori=bansos&wilayah=32.73")
  })

  test("canonical input is unchanged", () => {
    expect(canonicalizeSearch("?kategori=bansos&wilayah=32.73", list)).toEqual({
      search: "?kategori=bansos&wilayah=32.73",
      changed: false,
    })
  })

  test("drops invalid values and defaults", () => {
    expect(
      canonicalizeSearch(
        "?kategori=nope&status=in_progress&urut=terbaru&wilayah=32.73.01.1001",
        list,
      ).search,
    ).toBe("?status=in_progress")
  })

  test("first valid value wins", () => {
    expect(
      canonicalizeSearch("?kategori=x&kategori=bencana&kategori=bansos", list)
        .search,
    ).toBe("?kategori=bencana")
  })

  test("normalizes search text", () => {
    expect(
      canonicalizeSearch("?q=%20%20jalan%20%20rusak%20", list).search,
    ).toBe("?q=jalan+rusak")
    expect(canonicalizeSearch("?q=%20%20", list).search).toBe("")
  })

  test("short search text stays for the page message", () => {
    expect(canonicalizeSearch("?q=ab", list).search).toBe("?q=ab")
  })

  test("page numbers, page 1 omitted", () => {
    expect(canonicalizeSearch("?halaman=2", list).search).toBe("?halaman=2")
    for (const bad of ["1", "0", "-2", "02", "2.5", "abc", "1234567"]) {
      expect(canonicalizeSearch(`?halaman=${bad}`, list).search).toBe("")
    }
    expect(canonicalizeSearch("?kursor=MjA6YWJj_-", list).search).toBe("")
  })

  test("pageNumber reads canonical values", () => {
    expect(pageNumber(undefined)).toBe(1)
    expect(pageNumber("4")).toBe(4)
    expect(pageNumber("x")).toBe(1)
  })

  test("React Router parameters are junk on cacheable GETs", () => {
    // .data requests never reach here
    expect(canonicalizeSearch("?index&fbclid=x", list)).toEqual({
      search: "",
      changed: true,
    })
    expect(canonicalizeSearch("?_routes=root", {})).toEqual({
      search: "",
      changed: true,
    })
    expect(canonicalizeSearch("?q=abc&_routes=x", list).search).toBe("?q=abc")
  })

  test("is idempotent", () => {
    const corpus = [
      "?q=Air%20Bersih&kategori=program.air_bersih&urut=laporan",
      "?status=referred&status=closed&wilayah=11",
      "?q=a+b&q=c&fbclid=1&utm_medium=2",
      "?halaman=3&urut=aktivitas&kategori=bansos.ketepatan_sasaran",
      "?q=%F0%9F%98%80%20banjir",
      "?",
    ]
    for (const search of corpus) {
      const once = canonicalizeSearch(search, list).search
      expect(canonicalizeSearch(once, list)).toEqual({
        search: once,
        changed: false,
      })
    }
  })
})

describe("readQuery", () => {
  test("returns normalized values for loaders", () => {
    const params = new URLSearchParams(
      "q=%20banjir%20&urut=nope&kategori=bencana",
    )
    expect(readQuery(params, list)).toEqual({
      q: "banjir",
      kategori: "bencana",
    })
  })
})

describe("querySpecFor", () => {
  test("cacheable routes have specs", () => {
    expect(querySpecFor("/")).toEqual({})
    expect(querySpecFor("/isu")).toBe(ISSUE_LIST_QUERY)
    expect(querySpecFor("/isu/ISU-2026-10-0042")).toEqual({})
    expect(querySpecFor("/wilayah/32.73.json")).toEqual({})
    expect(querySpecFor("/tentang")).toEqual({})
    expect(querySpecFor("/data")).toBe(DATA_QUERY)
    expect(querySpecFor("/logo/0123456789abcdef.webp")).toEqual({})
  })

  test("public data API paths have specs", () => {
    expect(querySpecFor("/api/v1")).toEqual({})
    expect(querySpecFor("/api/v1/isu")).toBe(ISSUE_LIST_QUERY)
    expect(querySpecFor("/api/v1/isu/ISU-2026-10-0042")).toEqual({})
    expect(querySpecFor("/api/v1/tuntutan")).toBe(DEMAND_LIST_QUERY)
    expect(querySpecFor("/api/v1/tuntutan/TUN-ITB-26-0001")).toEqual({})
    expect(querySpecFor("/api/v1/data")).toEqual({})
    expect(querySpecFor("/api/v1/data/tren.csv")).toEqual({})
    expect(querySpecFor("/api/v1/isu/a/b")).toBeNull()
    expect(querySpecFor("/api/auth/get-session")).toBeNull()
  })

  test("tuntutan pages have specs", () => {
    expect(querySpecFor("/tuntutan")).toBe(DEMAND_LIST_QUERY)
    expect(querySpecFor("/tuntutan/TUN-ITB-26-0001")).toEqual({})
    expect(
      querySpecFor(
        "/tuntutan/TUN-ITB-26-0001/dokumen/0199c2b0-1d2e-7000-8000-000000000001.pdf",
      ),
    ).toEqual({})
    expect(querySpecFor("/tuntutan/TUN-ITB-26-0001/og.png")).not.toBeNull()
    expect(querySpecFor("/tuntutan/TUN-ITB-26-0001/laporkan")).toBeNull()
    expect(querySpecFor("/tuntutan/TUN-ITB-26-0001/berhenti")).toBeNull()
    expect(querySpecFor("/tuntutan/TUN-ITB-26-0001/nilai")).toBeNull()
  })

  test("tuntutan list keeps scope, province, status and search", () => {
    const canonical = (search: string) =>
      canonicalizeSearch(search, DEMAND_LIST_QUERY).search
    expect(
      canonical("?status=fulfilled&lingkup=daerah&provinsi=32&utm_source=x"),
    ).toBe("?lingkup=daerah&provinsi=32&status=fulfilled")
    expect(canonical("?lingkup=kota")).toBe("")
    expect(canonical("?provinsi=32.73")).toBe("")
    expect(canonical("?status=in_progress")).toBe("")
    expect(canonical("?q=%20air%20%20bersih%20")).toBe("?q=air+bersih")
    expect(canonical("?status=fulfilled&kategori=pendidikan")).toBe(
      "?kategori=pendidikan&status=fulfilled",
    )
    expect(canonical("?kategori=olahraga")).toBe("")
    expect(canonical("?halaman=2&lingkup=daerah")).toBe(
      "?halaman=2&lingkup=daerah",
    )
    expect(canonical("?halaman=1&kursor=abc")).toBe("")
  })

  test("dashboard keeps top categories, public stages and the view", () => {
    const canonical = (search: string) =>
      canonicalizeSearch(search, DATA_QUERY).search
    expect(canonical("?tampilan=tabel&kategori=bencana&utm_source=x")).toBe(
      "?kategori=bencana&tampilan=tabel",
    )
    expect(canonical("?tampilan=peta")).toBe("")
    expect(canonical("?kategori=bencana.banjir")).toBe("")
    // Public stages, like Jelajah
    expect(canonical("?status=confirmed_resolved")).toBe("")
    expect(canonical("?status=referred")).toBe("?status=referred")
    expect(canonical("?status=done")).toBe("?status=done")
  })

  test("dashboard has only the report layer", () => {
    const canonical = (search: string) =>
      canonicalizeSearch(search, DATA_QUERY).search
    // Tuntutan layer removed 25 Oct
    expect(canonical("?lapisan=tuntutan&tampilan=tabel")).toBe(
      "?tampilan=tabel",
    )
    expect(canonical("?lapisan=laporan")).toBe("")
    expect(canonical("?lapisan=isu")).toBe("")
  })

  test("dashboard keeps the issue ranking tab", () => {
    const canonical = (search: string) =>
      canonicalizeSearch(search, DATA_QUERY).search
    expect(canonical("?peringkat=terlama&tampilan=tabel")).toBe(
      "?peringkat=terlama&tampilan=tabel",
    )
    expect(canonical("?peringkat=laporan")).toBe("")
    expect(canonical("?peringkat=kepuasan")).toBe("")
    expect(canonical("?peringkat=didukung")).toBe("")
  })

  test("OG image keeps a positive integer version", () => {
    const spec = querySpecFor("/isu/ISU-2026-10-0042/og.png")
    expect(spec).not.toBeNull()
    if (spec === null) return
    expect(canonicalizeSearch("?v=3&fbclid=x", spec).search).toBe("?v=3")
    expect(canonicalizeSearch("?v=03", spec).search).toBe("?v=3")
    expect(canonicalizeSearch("?v=0", spec).search).toBe("")
    expect(canonicalizeSearch("?v=1e3", spec).search).toBe("")
  })

  test("private and unknown routes are not canonicalized", () => {
    for (const path of [
      "/lapor",
      "/lapor/sukses/LPR-2026-10-0001",
      "/isu/ISU-2026-10-0042/laporkan",
      "/kelola",
      "/api/upload/x",
      "/isu/",
      "/nope",
    ]) {
      expect(querySpecFor(path)).toBeNull()
    }
  })
})
