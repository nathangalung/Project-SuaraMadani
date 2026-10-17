import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { cacheProblem, missingScriptHashes, sessionProblem } from "./smoke.ts"

const sha = (text: string) =>
  `'sha256-${createHash("sha256").update(text).digest("base64")}'`

describe("missingScriptHashes", () => {
  const html = [
    "<script>window.a=1</script>",
    '<script type="module">import "/assets/x.js"</script>',
    '<script src="/assets/y.js"></script>',
    '<script type="application/ld+json">{"a":1}</script>',
  ].join("")

  test("all inline scripts hashed passes", () => {
    const csp = `script-src 'strict-dynamic' 'self' ${sha("window.a=1")} ${sha('import "/assets/x.js"')}`
    expect(missingScriptHashes(html, csp)).toEqual([])
  })

  test("names each unhashed inline script", () => {
    const csp = `default-src 'self'; script-src 'self' ${sha("window.a=1")}`
    expect(missingScriptHashes(html, csp)).toEqual([
      sha('import "/assets/x.js"'),
    ])
  })

  test("hashes outside script-src do not count", () => {
    const csp = `style-src ${sha("window.a=1")}; script-src 'self'`
    expect(missingScriptHashes("<script>window.a=1</script>", csp)).toEqual([
      sha("window.a=1"),
    ])
  })
})

describe("cacheProblem", () => {
  const anon = {
    status: 200,
    cacheStatus: "HIT",
    cacheControl: "public, max-age=0, no-transform",
  }

  test("a second anonymous HIT passes", () => {
    expect(cacheProblem(anon)).toBeNull()
  })

  test("a MISS on the second try fails", () => {
    expect(cacheProblem({ ...anon, cacheStatus: "MISS" })).toContain("MISS")
  })

  test("an error status fails", () => {
    expect(cacheProblem({ ...anon, status: 503 })).toContain("503")
  })
})

describe("sessionProblem", () => {
  test("bypass with private no-store passes", () => {
    expect(
      sessionProblem({
        status: 200,
        cacheStatus: "BYPASS",
        cacheControl: "private, no-store",
      }),
    ).toBeNull()
  })

  test("a cached session response fails", () => {
    expect(
      sessionProblem({
        status: 200,
        cacheStatus: "HIT",
        cacheControl: "private, no-store",
      }),
    ).toContain("HIT")
  })

  test("a public header on a session response fails", () => {
    expect(
      sessionProblem({
        status: 200,
        cacheStatus: "BYPASS",
        cacheControl: "public, max-age=0",
      }),
    ).toContain("public")
  })
})
