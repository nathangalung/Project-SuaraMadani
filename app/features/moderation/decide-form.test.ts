import { describe, expect, test } from "bun:test"
import { parseDecideForm } from "./decide-form.ts"

const ID = "0199f2a0-0000-7000-8000-000000000001"

function form(fields: Record<string, string | string[]>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) {
    for (const one of Array.isArray(value) ? value : [value]) {
      data.append(key, one)
    }
  }
  return data
}

const STATEMENT = "Ringkasan memuat alamat rumah, bagian itu kami hapus."

describe("parseDecideForm", () => {
  test("keep needs a keep reason and a statement", () => {
    expect(
      parseDecideForm(
        form({
          intent: "keep",
          stage: "first",
          subjectVersion: "3",
          reason: "no_violation",
          statement: STATEMENT,
        }),
      ),
    ).toEqual({
      input: {
        decision: "keep",
        stage: "first",
        subjectVersion: 3,
        reason: "no_violation",
        statement: STATEMENT,
      },
    })
  })

  test("a standard reason does not fit keep", () => {
    expect(
      parseDecideForm(
        form({
          intent: "keep",
          stage: "first",
          subjectVersion: "3",
          reason: "standard_3",
          statement: "pendek",
        }),
      ),
    ).toEqual({ decision: "keep", errors: ["decision_reason", "statement"] })
  })

  test("edit carries text and withdrawn files", () => {
    const parsed = parseDecideForm(
      form({
        intent: "edit",
        stage: "appeal",
        subjectVersion: "4",
        reason: "standard_11",
        statement: STATEMENT,
        title: "Atap sekolah runtuh di Coblong",
        summary: "Warga melaporkan atap kelas runtuh di Coblong.\r\nDua kelas.",
        withdraw: [ID, "bukan-uuid"],
      }),
    )
    expect(parsed).toEqual({
      input: {
        decision: "edit",
        stage: "appeal",
        subjectVersion: 4,
        reason: "standard_11",
        statement: STATEMENT,
        edit: {
          title: "Atap sekolah runtuh di Coblong",
          summary: "Warga melaporkan atap kelas runtuh di Coblong.\nDua kelas.",
          withdraw: [ID],
        },
      },
    })
  })

  test("edit text keeps the issue limits", () => {
    expect(
      parseDecideForm(
        form({
          intent: "edit",
          stage: "first",
          subjectVersion: "1",
          reason: "standard_11",
          statement: STATEMENT,
          title: "Pendek",
          summary: "",
        }),
      ),
    ).toEqual({ decision: "edit", errors: ["edit_title", "edit_summary"] })
  })

  test("hide and remove need the confirm box", () => {
    expect(
      parseDecideForm(
        form({
          intent: "remove",
          stage: "first",
          subjectVersion: "1",
          reason: "standard_8",
          statement: STATEMENT,
        }),
      ),
    ).toEqual({ decision: "remove", errors: ["confirm"] })
  })

  test("malformed requests are null", () => {
    expect(parseDecideForm(form({ intent: "delete" }))).toBeNull()
    expect(
      parseDecideForm(
        form({ intent: "keep", stage: "x", subjectVersion: "1" }),
      ),
    ).toBeNull()
    expect(
      parseDecideForm(
        form({ intent: "keep", stage: "first", subjectVersion: "satu" }),
      ),
    ).toBeNull()
  })
})
