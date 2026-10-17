import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { act } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { ErrorSummary, errorTitle, type FieldError } from "./error-summary"

describe("errorTitle", () => {
  test("prefixes the page title only when there are errors", () => {
    expect(errorTitle("Periksa dan Kirim", true)).toBe(
      "Kesalahan: Periksa dan Kirim",
    )
    expect(errorTitle("Periksa dan Kirim", false)).toBe("Periksa dan Kirim")
  })
})

describe("ErrorSummary", () => {
  test("lists each error as a link to its field", () => {
    const html = renderToStaticMarkup(
      <ErrorSummary
        errors={[
          { fieldId: "title", message: "Masukkan judul laporan" },
          { fieldId: "happened-day", message: "Tanggal harus berisi hari" },
        ]}
      />,
    )
    expect(html).toContain('tabindex="-1"')
    expect(html).toMatch(/<h2[^>]*id="[^"]+"[^>]*>Ada Masalah<\/h2>/)
    expect(html).toContain('href="#title"')
    expect(html).toContain(">Masukkan judul laporan</a>")
    expect(html).toContain('href="#happened-day"')
  })

  test("renders nothing without errors", () => {
    expect(renderToStaticMarkup(<ErrorSummary errors={[]} />)).toBe("")
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

  test("refocuses on every failed submit, not on re-render", async () => {
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
    expect(focused).toEqual(["alert"])
    // Same errors, new submit
    await render(2)
    expect(focused).toEqual(["alert", "alert"])
    // Re-render, no submit
    await render(2)
    expect(focused).toEqual(["alert", "alert"])
    await act(async () => root.unmount())
  })
})
