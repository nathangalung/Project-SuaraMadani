import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { m } from "~/paraglide/messages.js"
import { TWIBBON_FILTER, Twibbon } from "./twibbon"

describe("Twibbon", () => {
  test("server HTML shows the frame and says it needs JS", () => {
    const html = renderToStaticMarkup(<Twibbon />)
    expect(html).toContain(`>${m.twibbon_title()}</h2>`)
    expect(html).toContain(`src="${TWIBBON_FILTER}"`)
    expect(html).toContain(m.twibbon_needs_js())
    // No dead upload control
    expect(html).not.toContain('type="file"')
  })

  test("the photo never leaves the device", () => {
    const html = renderToStaticMarkup(<Twibbon />)
    expect(html).not.toMatch(/<form|action=/)
  })
})
