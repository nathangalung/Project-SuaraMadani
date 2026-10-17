import { createHash } from "node:crypto"

// Post-deploy check through the CDN
// Usage: bun smoke.ts <host>...

type Seen = { status: number; cacheStatus: string; cacheControl: string }

const SCRIPT_RE = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi
const SRC_RE = /\ssrc\s*=/i
const TYPE_RE = /\stype\s*=\s*"([^"]*)"/i
// Executable script types only
const JS_TYPES = new Set(["", "module", "text/javascript"])
const SESSION_COOKIE = "__Secure-sm.session_token=smoke-test"
const TIMEOUT_MS = 10_000

function hashOf(text: string): string {
  return `'sha256-${createHash("sha256").update(text, "utf8").digest("base64")}'`
}

/** Inline hashes missing from script-src. */
export function missingScriptHashes(html: string, csp: string): string[] {
  const scriptSrc =
    csp
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith("script-src ")) ?? ""
  const allowed = new Set(scriptSrc.split(/\s+/))
  const missing: string[] = []
  for (const [, attrs = "", body = ""] of html.matchAll(SCRIPT_RE)) {
    if (SRC_RE.test(attrs)) continue
    const type = TYPE_RE.exec(attrs)?.[1]?.toLowerCase() ?? ""
    if (!JS_TYPES.has(type)) continue
    const hash = hashOf(body)
    if (!allowed.has(hash) && !missing.includes(hash)) missing.push(hash)
  }
  return missing
}

/** Second anonymous request must HIT. */
export function cacheProblem(seen: Seen): string | null {
  if (seen.status !== 200) return `anonymous status ${seen.status}`
  if (seen.cacheStatus !== "HIT") return `anonymous cache ${seen.cacheStatus}`
  return null
}

/** Session requests never cached. */
export function sessionProblem(seen: Seen): string | null {
  if (seen.cacheStatus === "HIT") return "session response was a HIT"
  const control = seen.cacheControl
  if (!control.includes("private") || !control.includes("no-store")) {
    return `session cache-control ${control || "missing"}`
  }
  if (control.includes("public")) return "session response is public"
  return null
}

async function fetchSeen(
  url: string,
  cookie?: string,
): Promise<Seen & { html: string; csp: string }> {
  const res = await fetch(url, {
    headers: cookie ? { cookie } : {},
    redirect: "manual",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  return {
    status: res.status,
    cacheStatus: res.headers.get("cf-cache-status") ?? "none",
    cacheControl: res.headers.get("cache-control") ?? "",
    csp: res.headers.get("content-security-policy") ?? "",
    html: await res.text(),
  }
}

async function checkHost(host: string): Promise<string[]> {
  const url = `https://${host}/`
  const problems: string[] = []
  const first = await fetchSeen(url)
  // Cold cache: retry for HIT
  let second = await fetchSeen(url)
  for (let i = 0; i < 3 && cacheProblem(second); i++) {
    await Bun.sleep(1000)
    second = await fetchSeen(url)
  }
  const cached = cacheProblem(second)
  if (cached) problems.push(cached)
  for (const hash of missingScriptHashes(first.html, first.csp)) {
    problems.push(`inline script ${hash} not in CSP`)
  }
  const session = sessionProblem(await fetchSeen(url, SESSION_COOKIE))
  if (session) problems.push(session)
  return problems.map((problem) => `${host}: ${problem}`)
}

async function main(hosts: string[]): Promise<void> {
  if (hosts.length === 0) throw new Error("no hosts given")
  const problems = (await Promise.all(hosts.map(checkHost))).flat()
  for (const problem of problems) console.error(problem)
  console.log(JSON.stringify({ msg: "smoke", hosts, failed: problems.length }))
  process.exit(problems.length === 0 ? 0 : 1)
}

if (import.meta.main) await main(process.argv.slice(2))
