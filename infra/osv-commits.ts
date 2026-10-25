// Git dependencies by full commit
// Usage: bun osv-commits.ts <bun.lock>

type Fetcher = (url: string, init: RequestInit) => Promise<Response>
export type GitDep = { name: string; commit: string }

const PINS = new URL("./osv-commits.json", import.meta.url)
const QUERY = "https://api.osv.dev/v1/query"
const GIT_ENTRY = /"([^"\s]+)@(?:github:|git\+)[^"#\s]+#([0-9a-f]{7,40})"/g

/** Bun keeps only short commits. */
export function gitDeps(lock: string): GitDep[] {
  return [...lock.matchAll(GIT_ENTRY)].map(([, name = "", commit = ""]) => ({
    name,
    commit,
  }))
}

export function pinErrors(
  deps: GitDep[],
  pins: Record<string, string>,
): string[] {
  const errors: string[] = []
  for (const dep of deps) {
    const pin = pins[dep.name]
    if (!pin) errors.push(`${dep.name} ${dep.commit} has no full commit pin`)
    else if (!/^[0-9a-f]{40}$/.test(pin) || !pin.startsWith(dep.commit)) {
      errors.push(`${dep.name} pin ${pin} does not start with ${dep.commit}`)
    }
  }
  for (const name of Object.keys(pins)) {
    if (!deps.some((dep) => dep.name === name)) {
      errors.push(`${name} is pinned but not in the lockfile`)
    }
  }
  return errors
}

/** Any commit advisory blocks. */
export async function commitFindings(
  pins: Record<string, string>,
  fetcher: Fetcher = fetch,
): Promise<string[]> {
  const found: string[] = []
  for (const [name, commit] of Object.entries(pins)) {
    const response = await fetcher(QUERY, {
      method: "POST",
      redirect: "error",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commit }),
    })
    if (!response.ok) throw new Error(`osv query ${response.status}`)
    const body = (await response.json()) as { vulns?: { id: string }[] }
    for (const vuln of body.vulns ?? [])
      found.push(`${name} ${commit} ${vuln.id}`)
  }
  return found
}

/** Exit code, findings on stderr. */
export async function main(
  argv: string[],
  fetcher: Fetcher = fetch,
  pinsFile: string | URL = PINS,
): Promise<number> {
  const [path] = argv
  if (!path) throw new Error("usage: bun osv-commits.ts <bun.lock>")
  const pins = (await Bun.file(pinsFile).json()) as Record<string, string>
  const errors = pinErrors(gitDeps(await Bun.file(path).text()), pins)
  const found = errors.length ? [] : await commitFindings(pins, fetcher)
  for (const line of [...errors, ...found]) console.error(line)
  console.log(
    JSON.stringify({
      msg: "osv-commits",
      errors: errors.length,
      found: found.length,
    }),
  )
  return errors.length + found.length === 0 ? 0 : 1
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)))
