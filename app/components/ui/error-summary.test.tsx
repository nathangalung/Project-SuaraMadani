import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { act } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import {
  ErrorSummary,
  errorTitle,
  type FieldError,
  untouched,
} from "./error-summary"

describe("errorTitle", () => {
  test("prefixes the page title only when there are errors", () => {
    expect(errorTitle("Periksa dan Kirim", true)).toBe(
      "Kesalahan: Periksa dan Kirim",
    )
    expect(errorTitle("Periksa dan Kirim", false)).toBe("Periksa dan Kirim")
  })
})

describe("ErrorSummary", () => {
  test("no visible box, errors only for screen readers", () => {
    const html = renderToStaticMarkup(
      <ErrorSummary
        errors={[
          { fieldId: "title", message: "Masukkan judul laporan" },
          { fieldId: "happened-day", message: "Tanggal harus berisi hari" },
        ]}
      />,
    )
    expect(html).toMatch(/^<div role="status" class="sr-only">/)
    expect(html).toContain("<p>Ada Masalah</p>")
    expect(html).toContain("<li>Masukkan judul laporan</li>")
    expect(html).not.toMatch(/text-danger|border-|<h2/)
  })

  test("renders nothing without errors", () => {
    expect(renderToStaticMarkup(<ErrorSummary errors={[]} />)).toBe("")
  })
})

describe("untouched", () => {
  test("an edit drops only the error of the field it sits in", () => {
    class FakeElement extends EventTarget {
      constructor(readonly inside: FakeElement[] = []) {
        super()
      }
      contains(node: unknown) {
        return node === this || this.inside.includes(node as FakeElement)
      }
    }
    const radio = new FakeElement()
    const fields: Record<string, FakeElement> = {
      title: new FakeElement(),
      "relation-group": new FakeElement([radio]),
    }
    const saved = { Node: globalThis.Node, document: globalThis.document }
    Object.assign(globalThis, {
      Node: FakeElement,
      document: { getElementById: (id: string) => fields[id] ?? null },
    })
    const errors: FieldError[] = [
      { fieldId: "title", message: "Masukkan judul" },
      { fieldId: "relation-group", message: "Pilih hubungan" },
    ]
    const id = (e: FieldError) => e.fieldId
    expect(untouched(errors, id, radio).map(id)).toEqual(["title"])
    expect(untouched(errors, id, fields.title ?? null).map(id)).toEqual([
      "relation-group",
    ])
    // Unrelated edit: same array
    expect(untouched(errors, id, new FakeElement())).toBe(errors)
    Object.assign(globalThis, saved)
  })
})

// Just enough DOM for effects
class FakeNode {
  childNodes: FakeNode[] = []
  parentNode: FakeNode | null = null
  attributes: Record<string, string> = {}
  style: Record<string, string> = {}
  nodeValue: string | null = null
  namespaceURI = "http://www.w3.org/1999/xhtml"
  constructor(
    readonly nodeType: number,
    readonly nodeName: string,
    readonly ownerDocument: FakeDocument | null,
    readonly focused: string[],
  ) {}
  get tagName(): string {
    return this.nodeName
  }
  get firstChild(): FakeNode | null {
    return this.childNodes[0] ?? null
  }
  appendChild(node: FakeNode) {
    node.parentNode = this
    this.childNodes.push(node)
    return node
  }
  insertBefore(node: FakeNode, ref: FakeNode) {
    node.parentNode = this
    this.childNodes.splice(this.childNodes.indexOf(ref), 0, node)
    return node
  }
  removeChild(node: FakeNode) {
    this.childNodes.splice(this.childNodes.indexOf(node), 1)
    return node
  }
  setAttribute(name: string, value: string) {
    this.attributes[name] = String(value)
  }
  removeAttribute(name: string) {
    delete this.attributes[name]
  }
  addEventListener() {}
  removeEventListener() {}
  set textContent(value: string) {
    this.childNodes = []
    this.nodeValue = value
  }
  focus() {
    this.focused.push(this.attributes.role ?? this.nodeName)
  }
  matches(selector: string) {
    return selector.includes(this.nodeName.toLowerCase())
  }
  querySelector() {
    return null
  }
}

class FakeDocument extends FakeNode {
  cookie = ""
  constructor(focused: string[]) {
    super(9, "#document", null, focused)
  }
  get documentElement() {
    return this
  }
  createElement(tag: string) {
    return new FakeNode(1, tag.toUpperCase(), this, this.focused)
  }
  // Icons are SVG
  createElementNS(_ns: string, tag: string) {
    return new FakeNode(1, tag, this, this.focused)
  }
  // The invalid field
  field = new FakeNode(1, "INPUT", this, this.focused)
  getElementById(id: string) {
    return id === "title" ? this.field : null
  }
  createTextNode(text: string) {
    const node = new FakeNode(3, "#text", this, this.focused)
    node.nodeValue = text
    return node
  }
}

describe("ErrorSummary focus", () => {
  const focused: string[] = []
  const saved = { ...globalThis }
  beforeAll(() => {
    Object.assign(globalThis, {
      document: new FakeDocument(focused),
      window: globalThis,
      HTMLIFrameElement: class {},
      IS_REACT_ACT_ENVIRONMENT: true,
    })
  })
  afterAll(() => {
    for (const key of ["document", "window", "HTMLIFrameElement"]) {
      if (!(key in saved)) Reflect.deleteProperty(globalThis, key)
    }
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT")
  })

  const errors = (): FieldError[] => [
    { fieldId: "title", message: "Masukkan judul laporan" },
  ]

  test("focuses the first field on every failed submit, not on re-render", async () => {
    const { createRoot } = await import("react-dom/client")
    const doc = globalThis.document as unknown as FakeDocument
    const root = createRoot(
      doc.appendChild(doc.createElement("div")) as unknown as Element,
    )
    const render = (attempt: number) =>
      act(async () =>
        root.render(<ErrorSummary errors={errors()} attempt={attempt} />),
      )
    await render(1)
    expect(focused).toEqual(["INPUT"])
    // Same errors, new submit
    await render(2)
    expect(focused).toEqual(["INPUT", "INPUT"])
    // Re-render, no submit
    await render(2)
    expect(focused).toEqual(["INPUT", "INPUT"])
    await act(async () => root.unmount())
  })

  test("an edit that removes an error never moves focus", async () => {
    focused.length = 0
    const { createRoot } = await import("react-dom/client")
    const doc = globalThis.document as unknown as FakeDocument
    const root = createRoot(
      doc.appendChild(doc.createElement("div")) as unknown as Element,
    )
    const two: FieldError[] = [
      { fieldId: "title", message: "Masukkan judul laporan" },
      { fieldId: "story", message: "Masukkan cerita" },
    ]
    await act(async () =>
      root.render(<ErrorSummary errors={two} attempt={1} />),
    )
    expect(focused).toEqual(["INPUT"])
    // The edit clears one error
    await act(async () =>
      root.render(<ErrorSummary errors={two.slice(1)} attempt={1} />),
    )
    // List as attempt, like sign-in
    const left = two.slice(1)
    await act(async () =>
      root.render(<ErrorSummary errors={left} attempt={left} />),
    )
    await act(async () =>
      root.render(<ErrorSummary errors={[]} attempt={[]} />),
    )
    expect(focused).toEqual(["INPUT"])
    await act(async () => root.unmount())
  })
})
