import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { createElement, Suspense, use } from "react"
import { renderToReadableStream } from "react-dom/server"
import { cspFor, newMark } from "./csp.server.ts"

const sha = (text: string) =>
  `'sha256-${createHash("sha256").update(text, "utf8").digest("base64")}'`

function directive(csp: string, name: string): string[] {
  const found = csp
    .split(";")
    .map((part) => part.trim().split(/\s+/))
    .find(([key]) => key === name)
  return found ? found.slice(1) : []
}

function hashes(values: string[]): string[] {
  return values.filter((value) => value.startsWith("'sha256-"))
}

const MARK = "q9Xr2-Lm8ZtB4kWc1VnY0aPe"
const THEME = ":root{--theme-accent:#0f55d6}"
const RR_SCRIPTS = [
  "(function restore(){})()",
  "window.__reactRouterContext = {}",
  'import("/assets/b.js")',
  'window.__reactRouterContext.streamController.enqueue("[]");',
  "window.__reactRouterContext.streamController.close();",
]

// Shape of buffered RR render
function page(mark: string, content = "<p>Isi</p>"): string {
  const [restore, context, routes, enqueue, close] = RR_SCRIPTS
  return [
    "<!DOCTYPE html><html><head>",
    `<style>${THEME}</style>`,
    `<link rel="modulepreload" href="/assets/a.js" nonce="${mark}"/>`,
    "</head><body>",
    `<main>${content}</main>`,
    `<script nonce="${mark}">${restore}</script>`,
    `<script nonce="${mark}">${context}</script>`,
    `<script nonce="${mark}" type="module" async="">${routes}</script>`,
    `<script src="/assets/c.js" nonce="${mark}"></script>`,
    `<script nonce="${mark}">${enqueue}</script>`,
    `<script nonce="${mark}">${close}</script>`,
    "</body></html>",
  ].join("")
}

const prod = { dev: false, mark: MARK, styles: [THEME] }

describe("cspFor", () => {
  test("hashes every script our renderer tagged", () => {
    const scripts = directive(cspFor(page(MARK), prod).csp, "script-src")
    for (const body of RR_SCRIPTS) expect(scripts).toContain(sha(body))
    expect(hashes(scripts)).toHaveLength(RR_SCRIPTS.length)
    expect(scripts).toContain("'strict-dynamic'")
    expect(scripts).not.toContain("'unsafe-inline'")
  })

  test("an injected inline script gets no hash", () => {
    const html = page(MARK, "<div><script>steal()</script></div>")
    const scripts = directive(cspFor(html, prod).csp, "script-src")
    expect(scripts).not.toContain(sha("steal()"))
    expect(hashes(scripts)).toHaveLength(RR_SCRIPTS.length)
  })

  test("a guessed or forged mark gets no hash", () => {
    const content = [
      '<script nonce="guess">guess()</script>',
      '<script nonce="">empty()</script>',
      `<p>&lt;script nonce=&quot;${MARK}&quot;&gt;text()&lt;/script&gt;</p>`,
      `<script data-x=' nonce="guess"'>attr()</script>`,
    ].join("")
    const scripts = directive(
      cspFor(page(MARK, content), prod).csp,
      "script-src",
    )
    for (const body of ["guess()", "empty()", "text()", "attr()"]) {
      expect(scripts).not.toContain(sha(body))
    }
    expect(hashes(scripts)).toHaveLength(RR_SCRIPTS.length)
  })

  test("hashes only the theme style we built", () => {
    const html = page(MARK, "<style>body{display:none}</style>")
    const styles = directive(cspFor(html, prod).csp, "style-src")
    expect(styles).toContain(sha(THEME))
    expect(styles).not.toContain(sha("body{display:none}"))
    expect(hashes(styles)).toHaveLength(1)
    expect(styles).not.toContain("'unsafe-inline'")
  })

  test("no theme, no style hash", () => {
    const { csp } = cspFor(page(MARK), { ...prod, styles: [""] })
    expect(directive(csp, "style-src")).toEqual(["'self'"])
  })

  test("strips the mark, header never names it", () => {
    const { html, csp } = cspFor(page(MARK), prod)
    expect(html).not.toContain(MARK)
    expect(html).not.toContain("nonce=")
    expect(html).toContain(`<script>${RR_SCRIPTS[1]}</script>`)
    expect(csp).not.toContain("'nonce-")
  })

  test("output is cacheable across marks", () => {
    const other = "Zp4mQ7-wE2rT9yU1iO3aS5dF"
    const first = cspFor(page(MARK), prod)
    const second = cspFor(page(other), { ...prod, mark: other })
    expect(second).toEqual(first)
  })

  test("rejects a weak mark", () => {
    expect(() => cspFor(page(""), { ...prod, mark: "" })).toThrow()
    expect(() => cspFor(page("abc"), { ...prod, mark: "abc" })).toThrow()
    expect(() => cspFor(page('a"b'), { ...prod, mark: `${MARK}"` })).toThrow()
  })

  test("fresh marks are unguessable", () => {
    const marks = new Set(Array.from({ length: 64 }, newMark))
    expect(marks.size).toBe(64)
    for (const mark of marks) expect(mark).toMatch(/^[\w-]{24}$/)
  })

  test("locks down the remaining directives", () => {
    const { csp } = cspFor(page(MARK), prod)
    expect(directive(csp, "default-src")).toEqual(["'self'"])
    expect(directive(csp, "object-src")).toEqual(["'none'"])
    expect(directive(csp, "base-uri")).toEqual(["'none'"])
    expect(directive(csp, "frame-ancestors")).toEqual(["'none'"])
    expect(directive(csp, "form-action")).toEqual(["'self'"])
    expect(directive(csp, "frame-src")).toEqual([
      "https://challenges.cloudflare.com",
    ])
    expect(directive(csp, "connect-src")).toEqual(["'self'"])
  })

  test("images allow local previews, no remote hosts", () => {
    const { csp } = cspFor(page(MARK), prod)
    expect(directive(csp, "img-src")).toEqual(["'self'", "data:", "blob:"])
  })

  test("video plays from self and the media host only", () => {
    // blob: reads video metadata
    expect(directive(cspFor(page(MARK), prod).csp, "media-src")).toEqual([
      "'self'",
      "blob:",
    ])
    const { csp } = cspFor(page(MARK), {
      ...prod,
      mediaOrigin: "https://media.suaramadani.id",
    })
    expect(directive(csp, "media-src")).toEqual([
      "'self'",
      "blob:",
      "https://media.suaramadani.id",
    ])
    expect(directive(csp, "img-src")).not.toContain(
      "https://media.suaramadani.id",
    )
  })

  test("a malformed media origin is ignored", () => {
    const { csp } = cspFor(page(MARK), {
      ...prod,
      mediaOrigin: "https://x.id; script-src *",
    })
    expect(directive(csp, "media-src")).toEqual(["'self'", "blob:"])
  })

  test("dev allows Vite styles, HMR socket rides 'self'", () => {
    const { csp } = cspFor(page(MARK), { ...prod, dev: true })
    expect(directive(csp, "style-src")).toContain("'unsafe-inline'")
    expect(directive(csp, "connect-src")).toEqual(["'self'"])
  })

  test("dev loads Vite modules by origin, still trusted-only", () => {
    const html = page(MARK, "<script>steal()</script>")
    const scripts = directive(
      cspFor(html, { ...prod, dev: true }).csp,
      "script-src",
    )
    expect(scripts).not.toContain("'strict-dynamic'")
    expect(scripts).toContain("'self'")
    expect(scripts).toContain("https://challenges.cloudflare.com")
    expect(scripts).toContain(sha("window.__reactRouterContext = {}"))
    expect(scripts).not.toContain(sha("steal()"))
    expect(scripts).not.toContain("'unsafe-inline'")
    expect(scripts).not.toContain("'unsafe-eval'")
  })

  test("production never carries the dev relaxations", () => {
    const { csp } = cspFor(page(MARK), prod)
    expect(directive(csp, "script-src")[0]).toBe("'strict-dynamic'")
    expect(directive(csp, "script-src")).not.toContain(
      "https://challenges.cloudflare.com",
    )
    expect(directive(csp, "style-src")).not.toContain("'unsafe-inline'")
  })
})

// Real React render, same options
describe("cspFor on React output", () => {
  const late = Promise.resolve("x".repeat(600))

  function Late() {
    return createElement("p", null, use(late))
  }

  function Document({ mark }: { mark: string }) {
    return createElement(
      "html",
      null,
      createElement(
        "body",
        null,
        createElement("main", null, [
          createElement("div", {
            key: "raw",
            // biome-ignore lint/security/noDangerouslySetInnerHtml: simulated injection
            dangerouslySetInnerHTML: { __html: "<script>steal()</script>" },
          }),
          createElement(
            "p",
            { key: "text" },
            `<script nonce="${mark}">forged()</script>`,
          ),
          createElement(
            Suspense,
            { key: "late", fallback: null },
            createElement(Late),
          ),
        ]),
        createElement("script", {
          nonce: mark,
          // biome-ignore lint/security/noDangerouslySetInnerHtml: constant trusted script
          dangerouslySetInnerHTML: { __html: "trusted()" },
        }),
      ),
    )
  }

  async function render(mark: string): Promise<string> {
    const stream = await renderToReadableStream(
      createElement(Document, { mark }),
      { nonce: mark, progressiveChunkSize: 0 },
    )
    await stream.allReady
    return new Response(stream).text()
  }

  test("hashes tagged and React runtime scripts only", async () => {
    const mark = newMark()
    const raw = await render(mark)
    // Outlined boundary needs React's runtime
    expect(raw).toContain(`<script nonce="${mark}">$RB=[]`)
    const { html, csp } = cspFor(raw, { ...prod, mark })
    const scripts = directive(csp, "script-src")
    expect(scripts).toContain(sha("trusted()"))
    expect(scripts).not.toContain(sha("steal()"))
    expect(scripts).not.toContain(sha("forged()"))
    expect(html).toContain("&lt;script nonce=")
    expect(html).not.toContain(` nonce="${mark}"`)
    const tagged = /<script nonce="[^"]+"[^>]*>([\s\S]*?)<\/script>/g
    const runtime = [...raw.matchAll(tagged)]
    expect(runtime.length).toBe(3)
    for (const [, body = ""] of runtime) expect(scripts).toContain(sha(body))
  })
})
