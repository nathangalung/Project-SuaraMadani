import { describe, expect, test } from "bun:test"
import { syncFields } from "./url-fields"

describe("url fields", () => {
  test("uncontrolled fields follow the URL after Back", () => {
    const status = { value: "closed" }
    const sort = { value: "laporan" }
    const named: Record<string, unknown> = { status, urut: sort }
    syncFields(
      { namedItem: (name) => named[name] ?? null },
      {
        status: "",
        urut: "terbaru",
        missing: "x",
      },
    )
    expect(status.value).toBe("")
    expect(sort.value).toBe("terbaru")
  })
})
