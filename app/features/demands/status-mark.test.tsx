import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { FULFILMENT_STATUSES } from "../../../shared/status.ts"
import { FulfilmentMark, ProgressSquares, ResponseMark } from "./status-mark"

describe("tuntutan status marks", () => {
  test("no mark is red, waiting is neutral", () => {
    const marks = [
      ...FULFILMENT_STATUSES.map((status) =>
        renderToStaticMarkup(<FulfilmentMark status={status} />),
      ),
      renderToStaticMarkup(<ResponseMark status="not_responded" />),
      renderToStaticMarkup(<ResponseMark status="responded" />),
    ]
    for (const html of marks) expect(html).not.toContain("danger")
    expect(
      renderToStaticMarkup(<FulfilmentMark status="not_fulfilled" />),
    ).toContain("text-ink-soft")
    expect(
      renderToStaticMarkup(<ResponseMark status="not_responded" />),
    ).toContain("text-ink-soft")
  })

  test("every mark pairs an icon with its word", () => {
    const html = renderToStaticMarkup(<FulfilmentMark status="rejected" />)
    expect(html).toMatch(/<svg[^>]*aria-hidden="true"/)
    expect(html).toContain("Ditolak")
  })
})

describe("progress squares", () => {
  test("a refused item is hollow, never a filled square", () => {
    const html = renderToStaticMarkup(
      <ProgressSquares items={["fulfilled", "rejected"]} label="1 dari 2" />,
    )
    const [done, refused] = [...html.matchAll(/class="(size-3[^"]*)"/g)].map(
      (match) => match[1] ?? "",
    )
    expect(done).toContain("bg-success")
    expect(refused).toContain("border-2")
    expect(refused).not.toMatch(/\bbg-/)
    expect(html).not.toContain("danger")
  })
})
