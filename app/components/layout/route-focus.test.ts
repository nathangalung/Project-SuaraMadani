import { describe, expect, test } from "bun:test"
import {
  focusPageHeading,
  keepsFocusOnQuery,
  routeFocusGate,
  routeKey,
} from "./route-focus"

type Fake = {
  tag: string
  attrs: Record<string, string>
  focused: boolean
  matches(selector: string): boolean
  hasAttribute(name: string): boolean
  setAttribute(name: string, value: string): void
  focus(): void
}

function element(attrs: Record<string, string> = {}, tag = "h1"): Fake {
  return {
    tag,
    attrs,
    focused: false,
    matches(selector) {
      return selector
        .split(",")
        .some(
          (s) =>
            s === this.tag || (s === "[tabindex]" && "tabindex" in this.attrs),
        )
    },
    hasAttribute(name) {
      return name in this.attrs
    },
    setAttribute(name, value) {
      this.attrs[name] = value
    },
    focus() {
      this.focused = true
    },
  }
}

function root(found: Record<string, Fake | null>) {
  return {
    querySelector: (selector: string) => found[selector] ?? null,
  } as unknown as ParentNode
}

describe("routeKey", () => {
  test("hash-only changes keep the key, path and query change it", () => {
    const at = (pathname: string, search = "") => routeKey({ pathname, search })
    expect(at("/isu")).toBe(at("/isu"))
    expect(at("/isu")).not.toBe(at("/isu", "?urut=aktivitas"))
    expect(at("/isu")).not.toBe(at("/isu/ISU-2026-10-0001"))
  })
})

describe("focusPageHeading", () => {
  test("focuses the page h1 and makes it focusable", () => {
    const h1 = element()
    expect(focusPageHeading(root({ "main h1": h1 }))).toBe(true)
    expect(h1.focused).toBe(true)
    expect(h1.attrs.tabindex).toBe("-1")
  })

  test("keeps an existing tabindex", () => {
    const h1 = element({ tabindex: "0" })
    focusPageHeading(root({ "main h1": h1 }))
    expect(h1.attrs.tabindex).toBe("0")
  })

  test("a hash names the control to focus", () => {
    const input = element({}, "input")
    const h1 = element()
    const page = root({ 'main [id="evidence"]': input, "main h1": h1 })
    expect(focusPageHeading(page, "#evidence")).toBe(true)
    expect(input.focused).toBe(true)
    expect(h1.focused).toBe(false)
    // Stays in the tab order
    expect(input.attrs.tabindex).toBeUndefined()
  })

  test("unknown or unsafe hash falls back to the h1", () => {
    for (const hash of ["#nope", '#a"]', "#%E0%A4%A"]) {
      const h1 = element()
      expect(focusPageHeading(root({ "main h1": h1 }), hash)).toBe(true)
      expect(h1.focused).toBe(true)
    }
  })

  test("falls back to main, else does nothing", () => {
    const main = element()
    expect(focusPageHeading(root({ main }))).toBe(true)
    expect(main.focused).toBe(true)
    expect(focusPageHeading(root({}))).toBe(false)
  })
})

describe("routeFocusGate", () => {
  const at = (pathname: string, search = "") => ({ pathname, search })

  test("first load keeps focus, path and query changes move it", () => {
    const moves = routeFocusGate()
    expect(moves(at("/"), false)).toBe(false)
    expect(moves(at("/"), false)).toBe(false)
    expect(moves(at("/isu"), false)).toBe(true)
    expect(moves(at("/isu", "?urut=aktivitas"), false)).toBe(true)
  })

  test("in-place routes keep focus on query changes only", () => {
    const moves = routeFocusGate()
    moves(at("/data"), true)
    expect(moves(at("/data", "?kategori=program"), true)).toBe(false)
    expect(moves(at("/data", "?tampilan=tabel"), true)).toBe(false)
    expect(moves(at("/isu"), false)).toBe(true)
    expect(moves(at("/data"), true)).toBe(true)
  })
})

describe("keepsFocusOnQuery", () => {
  test("reads the route handle flag", () => {
    expect(keepsFocusOnQuery({ keepFocusOnQuery: true })).toBe(true)
    expect(keepsFocusOnQuery({ keepFocusOnQuery: "yes" })).toBe(false)
    expect(keepsFocusOnQuery({ shell: "auth" })).toBe(false)
    expect(keepsFocusOnQuery(undefined)).toBe(false)
  })
})
