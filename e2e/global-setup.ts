import { execFileSync } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
export const STAFF_STATE = join(HERE, ".auth", "staff.json")

/** Staff cookies via app code. */
export default function globalSetup(): void {
  const base = new URL(process.env.E2E_BASE_URL ?? "http://itb.localhost")
  const out = execFileSync(
    "bun",
    ["--env-file=.env", "e2e/staff-session.ts", base.hostname],
    { cwd: join(HERE, ".."), encoding: "utf8" },
  )
  const { cookie } = JSON.parse(out.trim().split("\n").at(-1) ?? "{}") as {
    cookie: string
  }
  const cookies = cookie.split("; ").map((pair) => {
    const at = pair.indexOf("=")
    return {
      name: pair.slice(0, at),
      value: pair.slice(at + 1),
      domain: base.hostname,
      path: "/",
      httpOnly: true,
      // localhost counts as secure
      secure: pair.startsWith("__Secure-"),
      sameSite: "Lax" as const,
      expires: -1,
    }
  })
  mkdirSync(dirname(STAFF_STATE), { recursive: true })
  writeFileSync(STAFF_STATE, JSON.stringify({ cookies, origins: [] }))
}
