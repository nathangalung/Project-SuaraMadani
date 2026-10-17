import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { pausableTimer, restoreFocus, TOAST_MS, ToastProvider } from "./toast"

function fakeClock() {
  let time = 0
  let pending: { at: number; run: () => void } | null = null
  return {
    clock: {
      now: () => time,
      schedule: (run: () => void, ms: number) => {
        pending = { at: time + ms, run }
        return () => {
          pending = null
        }
      },
    },
    advance(ms: number) {
      time += ms
      if (pending && pending.at <= time) {
        const { run } = pending
        pending = null
        run()
      }
    },
  }
}

describe("pausableTimer", () => {
  test("toasts stay five seconds", () => {
    expect(TOAST_MS).toBe(5000)
  })

  test("a pause keeps the remaining time", () => {
    const { clock, advance } = fakeClock()
    let done = 0
    const timer = pausableTimer(5000, () => done++, clock)
    timer.resume()
    advance(2000)
    timer.pause()
    advance(60_000)
    expect(done).toBe(0)
    timer.resume()
    advance(2999)
    expect(done).toBe(0)
    advance(1)
    expect(done).toBe(1)
  })

  test("repeated resume or pause changes nothing", () => {
    const { clock, advance } = fakeClock()
    let done = 0
    const timer = pausableTimer(1000, () => done++, clock)
    timer.resume()
    advance(500)
    timer.resume()
    advance(500)
    expect(done).toBe(1)
    timer.pause()
    timer.pause()
    expect(done).toBe(1)
  })
})

describe("ToastProvider", () => {
  test("polite region is mounted before any toast", () => {
    const html = renderToStaticMarkup(
      <ToastProvider>
        <p>Isi</p>
      </ToastProvider>,
    )
    expect(html).toMatch(/<div role="status" aria-live="polite"[^>]*><\/div>/)
    expect(html).not.toContain("assertive")
  })
})

describe("toast placement and focus", () => {
  test("mobile region sits near the edge", () => {
    const html = renderToStaticMarkup(<ToastProvider>x</ToastProvider>)
    expect(html).not.toContain("bottom-20")
    expect(html).toContain("bottom-[max(1rem,env(safe-area-inset-bottom))]")
  })

  function fakeHeading() {
    const heading = {
      focused: 0,
      attrs: new Map<string, string>(),
      hasAttribute: (name: string) => heading.attrs.has(name),
      setAttribute: (name: string, value: string) => {
        heading.attrs.set(name, value)
      },
      focus: () => {
        heading.focused++
      },
    }
    const root = { querySelector: () => heading } as unknown as ParentNode
    return { heading, root }
  }

  test("closing returns focus to the opener", () => {
    const { heading, root } = fakeHeading()
    let focused = 0
    restoreFocus({ isConnected: true, focus: () => focused++ }, root)
    expect(focused).toBe(1)
    expect(heading.focused).toBe(0)
  })

  test("a gone opener sends focus to the heading", () => {
    const { heading, root } = fakeHeading()
    restoreFocus({ isConnected: false, focus: () => {} }, root)
    restoreFocus(null, root)
    expect(heading.focused).toBe(2)
    expect(heading.attrs.get("tabindex")).toBe("-1")
  })
})
