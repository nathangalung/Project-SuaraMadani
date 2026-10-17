import { describe, expect, test } from "bun:test"
import {
  parseDemandFields,
  parseItemLines,
  parseItemUpdate,
} from "./demand-form"

const TODAY = "2026-10-16"

function form(values: Record<string, string>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(values)) data.set(key, value)
  return data
}

const VALID = {
  scope: "regional",
  provinceCode: "32",
  regencyCode: "32.73",
  title: "Buka data penerima bantuan pangan",
  body: "Kami menuntut daftar penerima bantuan pangan dibuka per kelurahan.",
  summary: "Daftar penerima dibuka agar warga bisa mengawasi.",
  target: "Pemerintah Kota Bandung",
  raisedOn: "2026-09-01",
}

describe("parseDemandFields", () => {
  test("a regional demand keeps its region", () => {
    expect(parseDemandFields(form(VALID), TODAY)).toEqual({
      ok: true,
      fields: { ...VALID, scope: "regional" },
    })
  })

  test("national drops any region sent", () => {
    const parsed = parseDemandFields(
      form({ ...VALID, scope: "national" }),
      TODAY,
    )
    expect(parsed).toMatchObject({
      ok: true,
      fields: { scope: "national", provinceCode: null, regencyCode: null },
    })
  })

  test("regional needs a province, regency inside it", () => {
    expect(
      parseDemandFields(form({ ...VALID, provinceCode: "" }), TODAY),
    ).toEqual({ ok: false, errors: ["province"] })
    expect(
      parseDemandFields(form({ ...VALID, regencyCode: "33.01" }), TODAY),
    ).toEqual({ ok: false, errors: ["regency"] })
    expect(
      parseDemandFields(form({ ...VALID, regencyCode: "" }), TODAY),
    ).toMatchObject({ ok: true, fields: { regencyCode: null } })
  })

  test("lengths, scope and a past date", () => {
    expect(
      parseDemandFields(
        form({
          ...VALID,
          scope: "kota",
          title: "Pendek",
          raisedOn: "2026-10-17",
        }),
        TODAY,
      ),
    ).toEqual({ ok: false, errors: ["scope", "title", "raised_on"] })
  })
})

describe("parseItemLines", () => {
  test("one per line, blanks dropped", () => {
    expect(
      parseItemLines(
        "Publikasi daftar penerima\n\n  Jadwal penyaluran dibuka  \n",
      ),
    ).toEqual({
      ok: true,
      items: ["Publikasi daftar penerima", "Jadwal penyaluran dibuka"],
    })
  })

  test("short lines and too many are refused", () => {
    expect(parseItemLines("Pendek")).toEqual({ ok: false, errors: ["items"] })
    const many = Array.from({ length: 13 }, (_, i) => `Sub-tuntutan nomor ${i}`)
    expect(parseItemLines(many.join("\n"))).toEqual({
      ok: false,
      errors: ["items"],
    })
  })
})

describe("parseItemUpdate", () => {
  const update = {
    itemId: "0199c2b0-1d2e-7000-8000-000000000001",
    version: "2",
    response: "responded",
    fulfilment: "partially_fulfilled",
    occurredOn: "2026-10-10",
    note: "Dinas menjawab surat dan membuka sebagian data.",
    sourceText: "Surat Dinas Sosial 12/2026",
    sourceUrl: "https://contoh.go.id/surat",
  }

  test("status change with a dated source", () => {
    expect(
      parseItemUpdate(form(update), TODAY, "2026-09-01", {
        response: "not_responded",
        fulfilment: "not_fulfilled",
      }),
    ).toEqual({
      ok: true,
      value: {
        itemId: update.itemId,
        version: 2,
        to: { response: "responded", fulfilment: "partially_fulfilled" },
        occurredOn: "2026-10-10",
        note: update.note,
        sourceText: update.sourceText,
        sourceUrl: update.sourceUrl,
      },
    })
  })

  test("same statuses become a note", () => {
    const parsed = parseItemUpdate(
      form({ ...update, sourceUrl: "" }),
      TODAY,
      "2026-09-01",
      {
        response: "responded",
        fulfilment: "partially_fulfilled",
      },
    )
    expect(parsed).toMatchObject({
      ok: true,
      value: { to: null, sourceUrl: null },
    })
  })

  test("a date before raising, no source, bad link", () => {
    expect(
      parseItemUpdate(
        form({
          ...update,
          occurredOn: "2026-08-01",
          sourceText: "",
          sourceUrl: "javascript:alert(1)",
          note: "",
        }),
        TODAY,
        "2026-09-01",
        { response: "not_responded", fulfilment: "not_fulfilled" },
      ),
    ).toEqual({
      ok: false,
      errors: ["occurred_on", "note", "source_text", "source_url"],
    })
  })

  test("a status change before the last one is named", () => {
    const current = {
      response: "not_responded",
      fulfilment: "not_fulfilled",
    } as const
    const at = (occurredOn: string, floor: string | null) =>
      parseItemUpdate(
        form({ ...update, occurredOn }),
        TODAY,
        "2026-09-01",
        current,
        floor,
      )
    expect(at("2026-10-10", "2026-10-11")).toEqual({
      ok: false,
      errors: ["occurred_before_last"],
    })
    expect(at("2026-10-11", "2026-10-11")?.ok).toBe(true)
    // Notes may be earlier
    const note = parseItemUpdate(
      form({ ...update, occurredOn: "2026-10-01" }),
      TODAY,
      "2026-09-01",
      { response: "responded", fulfilment: "partially_fulfilled" },
      "2026-10-11",
    )
    expect(note?.ok).toBe(true)
  })

  test("a disallowed status move is named", () => {
    expect(
      parseItemUpdate(
        form({ ...update, response: "not_responded", fulfilment: "rejected" }),
        TODAY,
        "2026-09-01",
        { response: "not_responded", fulfilment: "not_fulfilled" },
      ),
    ).toEqual({ ok: false, errors: ["status"] })
  })

  test("malformed ids are null", () => {
    expect(
      parseItemUpdate(form({ ...update, itemId: "x" }), TODAY, "2026-09-01", {
        response: "not_responded",
        fulfilment: "not_fulfilled",
      }),
    ).toBeNull()
  })
})
