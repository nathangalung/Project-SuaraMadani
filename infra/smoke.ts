import { createHash } from "node:crypto"
import { connect, type SecureVersion } from "node:tls"

// Post-deploy check through the CDN
// Usage: bun smoke.ts [edge] <host>...

type Seen = { status: number; cacheStatus: string; cacheControl: string }
type Plain = { status: number; location: string }
type TlsSeen = Record<SecureVersion, boolean>

const SCRIPT_RE = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi
const SRC_RE = /\ssrc\s*=/i
const TYPE_RE = /\stype\s*=\s*"([^"]*)"/i
// Executable script types only
const JS_TYPES = new Set(["", "module", "text/javascript"])
const SESSION_COOKIE = "__Host-sb.session_token=smoke-test"
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

/** TLS 1.2 floor, 1.3 on. */
export function tlsProblems(seen: TlsSeen): string[] {
  const problems: string[] = []
  for (const old of ["TLSv1", "TLSv1.1"] as const) {
    if (seen[old]) problems.push(`${old} accepted`)
  }
  for (const wanted of ["TLSv1.2", "TLSv1.3"] as const) {
    if (!seen[wanted]) problems.push(`${wanted} refused`)
  }
  return problems
}

/** Plain page: 301 to https. */
export function plainPageProblem(host: string, seen: Plain): string | null {
  const target = `https://${host}/`
  if (seen.status === 301 && seen.location === target) return null
  return `http:// answered ${seen.status} ${seen.location || "without Location"}, expected 301 to ${target}`
}

/** Plain http API: blocked. */
export function plainApiProblem(seen: Plain): string | null {
  if (seen.status === 403 && !seen.location) return null
  return `http:// /api/v1 answered ${seen.status}, expected the WAF block 403`
}

/** HSTS with a positive max-age. */
export function hstsProblem(header: string): string | null {
  if (!header) return "Strict-Transport-Security missing"
  const age = /max-age=(\d+)/i.exec(header)?.[1]
  if (Number(age) > 0) return null
  return `Strict-Transport-Security ${header}`
}

type Fetch = (url: string, init: RequestInit) => Promise<Response>

/** Network seams, real by default. */
export type Net = {
  fetch: Fetch
  tlsAccepts: (host: string, version: SecureVersion) => Promise<boolean>
  sleep: (ms: number) => Promise<void>
}

async function fetchSeen(
  net: Net,
  url: string,
  cookie?: string,
): Promise<Seen & { html: string; csp: string }> {
  const res = await net.fetch(url, {
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

async function checkHost(net: Net, host: string): Promise<string[]> {
  const url = `https://${host}/`
  const problems: string[] = []
  const first = await fetchSeen(net, url)
  // Cold cache: retry for HIT
  let second = await fetchSeen(net, url)
  for (let i = 0; i < 3 && cacheProblem(second); i++) {
    await net.sleep(1000)
    second = await fetchSeen(net, url)
  }
  const cached = cacheProblem(second)
  if (cached) problems.push(cached)
  for (const hash of missingScriptHashes(first.html, first.csp)) {
    problems.push(`inline script ${hash} not in CSP`)
  }
  const session = sessionProblem(await fetchSeen(net, url, SESSION_COOKIE))
  if (session) problems.push(session)
  return problems.map((problem) => `${host}: ${problem}`)
}

/** Handshake pinned to one version. */
export function tlsAccepts(
  host: string,
  version: SecureVersion,
  port = 443,
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({
      host,
      port,
      servername: host,
      minVersion: version,
      maxVersion: version,
      timeout: TIMEOUT_MS,
    })
    const done = (accepted: boolean) => {
      socket.destroy()
      resolve(accepted)
    }
    socket.once("secureConnect", () => done(socket.getProtocol() === version))
    socket.once("error", () => done(false))
    socket.once("timeout", () => done(false))
  })
}

async function fetchPlain(net: Net, url: string): Promise<Plain> {
  const res = await net.fetch(url, {
    redirect: "manual",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  await res.body?.cancel()
  return { status: res.status, location: res.headers.get("location") ?? "" }
}

/** Cloudflare Checklist, not the release. */
async function checkEdge(net: Net, host: string): Promise<string[]> {
  const versions: SecureVersion[] = ["TLSv1", "TLSv1.1", "TLSv1.2", "TLSv1.3"]
  const accepted = await Promise.all(
    versions.map((v) => net.tlsAccepts(host, v)),
  )
  const seen = Object.fromEntries(
    versions.map((version, i) => [version, accepted[i] === true]),
  ) as TlsSeen
  const problems = tlsProblems(seen)
  const page = plainPageProblem(host, await fetchPlain(net, `http://${host}/`))
  if (page) problems.push(page)
  const api = plainApiProblem(await fetchPlain(net, `http://${host}/api/v1`))
  if (api) problems.push(api)
  const res = await net.fetch(`https://${host}/`, {
    redirect: "manual",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  await res.body?.cancel()
  const hsts = hstsProblem(res.headers.get("strict-transport-security") ?? "")
  if (hsts) problems.push(hsts)
  return problems.map((problem) => `${host}: ${problem}`)
}

const NET: Net = { fetch, tlsAccepts, sleep: Bun.sleep }

/** Exit code, problems on stderr. */
export async function smoke(args: string[], net: Net = NET): Promise<number> {
  const edge = args[0] === "edge"
  const hosts = edge ? args.slice(1) : args
  if (hosts.length === 0) throw new Error("no hosts given")
  const check = edge ? checkEdge : checkHost
  const problems = (await Promise.all(hosts.map((h) => check(net, h)))).flat()
  for (const problem of problems) console.error(problem)
  const msg = edge ? "smoke edge" : "smoke"
  console.log(JSON.stringify({ msg, hosts, failed: problems.length }))
  return problems.length === 0 ? 0 : 1
}

if (import.meta.main) process.exit(await smoke(process.argv.slice(2)))
