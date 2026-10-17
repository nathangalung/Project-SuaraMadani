import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { DrizzleQueryError } from "drizzle-orm/errors"
import { Suspense } from "react"
import type { EntryContext } from "react-router"
import { handleError, renderHtml, themeCss } from "./entry.server.tsx"

const PHONE = "+6281299998888"
const spy = spyOn(console, "error").mockImplementation(() => {})

afterEach(() => spy.mockClear())

function args(path = "/lapor/periksa") {
  const request = new Request(`http://itb.localhost${path}`, {
    method: "POST",
  })
  return { request, params: {}, context: undefined } as unknown as Parameters<
    typeof handleError
  >[1]
}

function lines(): string[] {
  return spy.mock.calls.map((call) => call.map(String).join(" "))
}

describe("handleError", () => {
  test("a DB failure logs one line without values", () => {
    const cause = Object.assign(new Error("deadlock"), {
      severity: "ERROR",
      code: "57014",
    })
    handleError(
      new DrizzleQueryError("insert into reports", [PHONE], cause),
      args(),
    )
    expect(lines()).toHaveLength(1)
    const line = lines()[0] ?? ""
    expect(line).not.toContain(PHONE)
    expect(JSON.parse(line)).toMatchObject({
      msg: "server error",
      path: "/lapor/periksa",
      code: "57014",
    })
  })

  test("React Router's cross-origin 400 logs one line, no stack", () => {
    handleError(
      new Error(
        "The `request.url` origin does not match `origin` header from a forwarded action request. Aborting the action.",
      ),
      args(),
    )
    expect(lines()).toHaveLength(1)
    const record = JSON.parse(lines()[0] ?? "")
    expect(record).toMatchObject({ msg: "client error", status: 400 })
    expect(record.stack).toBeUndefined()
  })

  test("expected route responses stay silent", () => {
    // Shape of ErrorResponseImpl
    const notFound = {
      status: 404,
      statusText: "Not Found",
      internal: false,
      data: null,
    }
    handleError(notFound, args())
    expect(lines()).toEqual([])
  })
})

describe("themeCss", () => {
  const context = (loaderData: object, errors: object | null) =>
    ({
      staticHandlerContext: { loaderData, errors },
    }) as unknown as EntryContext
  // Shape of ErrorResponseImpl
  const forbidden = (data: unknown) => ({
    status: 403,
    statusText: "",
    internal: false,
    data,
  })

  test("the root loader's theme wins", () => {
    expect(
      themeCss(context({ root: { themeCss: ":root{a:1}" } }, null)),
    ).toEqual([":root{a:1}"])
  })

  test("a middleware 403 keeps its shell style", () => {
    const errors = {
      root: forbidden({ shell: { themeCss: ":root{b:2}" }, staff: false }),
    }
    expect(themeCss(context({}, errors))).toEqual([":root{b:2}"])
  })

  test("other error bodies add no style", () => {
    const errors = {
      root: forbidden({ shell: { themeCss: 5 } }),
      other: { themeCss: ":root{c:3}" },
    }
    expect(themeCss(context({}, errors))).toEqual([])
  })
})

describe("renderHtml", () => {
  test("a large boundary stays inline", async () => {
    const body = "Halaman Tidak Ditemukan ".repeat(1000)
    const html = await renderHtml(
      <main>
        <Suspense>
          <h1>{body}</h1>
        </Suspense>
      </main>,
      {},
    )
    expect(html).not.toMatch(/\$RC|<template|hidden/)
    expect(html).toContain(`<h1>${body}</h1>`)
  })
})
