import { createHash, randomBytes } from "node:crypto"

export type CspOptions = {
  dev: boolean
  // Per-request render tag
  mark: string
  // Exact CSS the server built
  styles: readonly string[]
  // R2 public video host
  mediaOrigin?: string
}

export type SecuredPage = { html: string; csp: string }

const SCRIPT_RE = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi
const SRC_ATTR_RE = /\ssrc\s*=/i
const NONCE_ATTR_RE = /\snonce="([^"]*)"/i
const MARK_RE = /^[\w-]{16,}$/
const TURNSTILE = "https://challenges.cloudflare.com"
const ORIGIN = /^https:\/\/[a-z0-9.-]+(?::\d{1,5})?$/

function hash(text: string): string {
  return `'sha256-${createHash("sha256").update(text, "utf8").digest("base64")}'`
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

/** Unguessable tag for one render. */
export function newMark(): string {
  return randomBytes(18).toString("base64url")
}

/** Hash tagged inline, strip tags. */
export function cspFor(
  html: string,
  { dev, mark, styles, mediaOrigin }: CspOptions,
): SecuredPage {
  if (!MARK_RE.test(mark)) throw new Error("weak CSP mark")
  const scripts = unique(
    [...html.matchAll(SCRIPT_RE)]
      .filter(
        ([, attrs = ""]) =>
          !SRC_ATTR_RE.test(attrs) && NONCE_ATTR_RE.exec(attrs)?.[1] === mark,
      )
      .map(([, , body = ""]) => hash(body)),
  )
  const styleHashes = unique(styles.filter(Boolean).map(hash))
  const directives: [string, ...string[]][] = [
    ["default-src", "'self'"],
    // Dev: Vite imports unhashed modules
    dev
      ? ["script-src", "'self'", TURNSTILE, ...scripts]
      : ["script-src", "'strict-dynamic'", "'self'", ...scripts],
    ["style-src", "'self'", ...(dev ? ["'unsafe-inline'"] : styleHashes)],
    // Turnstile widget sets style attributes
    ["style-src-attr", "'unsafe-inline'"],
    // blob: for evidence previews
    ["img-src", "'self'", "data:", "blob:"],
    [
      "media-src",
      "'self'",
      // Step 5 reads video metadata
      "blob:",
      ...(mediaOrigin && ORIGIN.test(mediaOrigin) ? [mediaOrigin] : []),
    ],
    ["font-src", "'self'"],
    ["connect-src", "'self'"],
    ["frame-src", TURNSTILE],
    ["object-src", "'none'"],
    ["base-uri", "'none'"],
    ["frame-ancestors", "'none'"],
    ["form-action", "'self'"],
  ]
  return {
    html: html.replaceAll(` nonce="${mark}"`, ""),
    csp: directives.map((parts) => parts.join(" ")).join("; "),
  }
}
