import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

const root = import.meta.dir
const readJson = (path: string) => Bun.file(join(root, path)).json()

type Diagnostic = {
  category: string
  location: { path: string; start: { line: number } }
}

// Lint probes, repo rules
describe("biome import bans", () => {
  const imports = {
    db: "../db/schema/reports.ts",
    plainServer: "../server/log.ts",
    serverModule: "../server/theme.server.ts",
  }
  const files = [
    "app/root.tsx",
    "app/context.ts",
    "app/routes.ts",
    "app/routes/home.tsx",
    "app/routes/api/probe.ts",
    "app/components/probe.tsx",
    "app/features/probe.ts",
  ]
  const mayImportServerModule = new Set([
    "app/root.tsx",
    "app/routes/api/probe.ts",
  ])
  const flagged = new Map<string, Set<number>>()
  let dir = ""

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "biome-bans-"))
    const config = await readJson("biome.json")
    delete config.$schema
    delete config.vcs
    await Bun.write(join(dir, "biome.json"), JSON.stringify(config))
    const source = Object.values(imports)
      .map((spec, i) => `import * as m${i} from "${spec}"\n`)
      .join("")
      .concat(
        `export const all = [${Object.keys(imports).map((_, i) => `m${i}`)}]\n`,
      )
    for (const file of files) {
      await mkdir(dirname(join(dir, file)), { recursive: true })
      await Bun.write(join(dir, file), source)
    }
    const run = Bun.spawnSync(
      [
        join(root, "node_modules/.bin/biome"),
        "lint",
        "--reporter=json",
        "--only=style/noRestrictedImports",
        "app",
      ],
      { cwd: dir },
    )
    const report = JSON.parse(run.stdout.toString()) as {
      diagnostics: Diagnostic[]
    }
    for (const d of report.diagnostics) {
      if (d.category !== "lint/style/noRestrictedImports") continue
      const lines = flagged.get(d.location.path) ?? new Set()
      lines.add(d.location.start.line)
      flagged.set(d.location.path, lines)
    }
  })

  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true })
  })

  for (const file of files) {
    test(`${file} cannot import db/ or plain server/`, () => {
      const lines = flagged.get(file) ?? new Set()
      expect(lines.has(1)).toBe(true)
      expect(lines.has(2)).toBe(true)
    })
    test(`${file} server module rule`, () => {
      const lines = flagged.get(file) ?? new Set()
      expect(lines.has(3)).toBe(!mayImportServerModule.has(file))
    })
  }
})

// Whole icon set defeats tree-shaking
describe("lucide imports", () => {
  test("named icon imports only", async () => {
    const hits: string[] = []
    const glob = new Bun.Glob("{app,shared}/**/*.{ts,tsx}")
    for await (const file of glob.scan({ cwd: root })) {
      const source = await Bun.file(join(root, file)).text()
      const imports = source.matchAll(
        /import\s*\{([^}]*)\}\s*from\s*"(lucide-react[^"]*)"/g,
      )
      for (const [, names = "", from] of imports) {
        const bad =
          from !== "lucide-react" || /\b(DynamicIcon|icons)\b/.test(names)
        if (bad) hits.push(file)
      }
      if (
        /(import\s*\*|import\s+\w+)\s+(as\s+\w+\s+)?from\s*"lucide/.test(source)
      ) {
        hits.push(file)
      }
    }
    expect(hits).toEqual([])
  })
})

describe("error page chunk", () => {
  test("routes load it lazily", async () => {
    const hits: string[] = []
    const glob = new Bun.Glob("app/**/*.tsx")
    for await (const file of glob.scan({ cwd: root })) {
      const source = await Bun.file(join(root, file)).text()
      if (
        /^import [^;]*from "~\/components\/layout\/error-page"/m.test(source)
      ) {
        hits.push(file)
      }
    }
    expect(hits).toEqual([])
  })
})

// Line comment text, any syntax
function commentOf(line: string, sql: boolean): string | undefined {
  const found =
    (sql ? line.match(/^\s*--\s?(.*)$/) : null) ??
    // JSX comments open with {
    line.match(/^\s*\{?(?:\/\/|\/\*\*?|\*(?!\/))\s?(.*?)\s*(?:\*\/)?\}?\s*$/)
  const text = found?.[1]?.trim()
  return text && !/^(biome-ignore|@ts-)/.test(text) ? text : undefined
}

describe("comment rule", () => {
  test("five words at most, no semicolon", async () => {
    const hits: string[] = []
    const files: string[] = []
    for (const pattern of [
      "*.{ts,js}",
      "{app,server,db,shared,worker,infra,e2e}/**/*.{ts,tsx,js,css,sql}",
    ]) {
      for await (const file of new Bun.Glob(pattern).scan({ cwd: root })) {
        if (!file.startsWith("app/paraglide/")) files.push(file)
      }
    }
    for (const file of files) {
      const lines = (await Bun.file(join(root, file)).text()).split("\n")
      lines.forEach((line, index) => {
        const text = commentOf(line, file.endsWith(".sql"))
        if (text && (text.split(/\s+/).length > 5 || text.includes(";"))) {
          hits.push(`${file}:${index + 1}`)
        }
      })
    }
    expect(files.length).toBeGreaterThan(200)
    expect(hits).toEqual([])
  })

  test("hash comments too: shell, YAML, config", async () => {
    const hits: string[] = []
    const files: string[] = []
    for (const pattern of [
      ".env.example",
      ".github/workflows/*.yml",
      "infra/**/{*.sh,*.yml,*.yaml,*.conf,*.example,*.service,*.timer,*.mount,*Dockerfile,Caddyfile}",
    ]) {
      for await (const file of new Bun.Glob(pattern).scan({
        cwd: root,
        dot: true,
      })) {
        files.push(file)
      }
    }
    for (const file of files) {
      const lines = (await Bun.file(join(root, file)).text()).split("\n")
      lines.forEach((line, index) => {
        const text = /^\s*#(?!!)\s?(.*)$/.exec(line)?.[1]?.trim()
        // Tool directives, not prose
        if (!text || /^(shellcheck|syntax=|renovate:)/.test(text)) return
        if (text.split(/\s+/).length > 5 || text.includes(";")) {
          hits.push(`${file}:${index + 1}`)
        }
      })
    }
    expect(files.length).toBeGreaterThan(30)
    expect(hits).toEqual([])
  })
})

// Renamed 21 October 2026
describe("product name", () => {
  // Kept lines, see ADR-19
  const kept: Record<string, string[]> = {
    "PLAN.md": [
      "Nama tampilan diganti dari",
      'kata "madani" juga dipakai',
      "Ganti nama paket menjadi",
    ],
    "docs/architecture.md": ["repository folder, name kept"],
    "docs/decisions.md": [
      "- **Context:** The display name changed",
      "- **Kept, by design:**",
      "- **Consequences:** No production host",
    ],
  }
  // Frontend is the teammate's
  const skipped =
    /^(app|public|messages|project\.inlang)\/|^(DESIGN\.md|\.env|tooling\.test\.ts)$/
  const backend = /^[^/]+$|^(server|worker|db|shared|infra|docs|e2e|\.github)\//

  // Repo files, not ignored
  const repoFiles = () => {
    const listed = Bun.spawnSync(
      [
        "git",
        "-c",
        `safe.directory=${root}`,
        "ls-files",
        "-co",
        "--exclude-standard",
        "-z",
      ],
      { cwd: root },
    )
    expect(listed.exitCode).toBe(0)
    return listed.stdout
      .toString()
      .split("\0")
      .filter((file) => backend.test(file) && !skipped.test(file))
  }

  // Lines matching, minus kept
  async function scan(
    pattern: RegExp,
    keep: (file: string, line: string) => boolean,
  ) {
    const hits: string[] = []
    let scanned = 0
    for (const file of repoFiles()) {
      // Tracked but deleted
      const source = Bun.file(join(root, file))
      if (!(await source.exists())) continue
      scanned++
      const lines = (await source.text()).split("\n")
      lines.forEach((line, index) => {
        if (pattern.test(line) && !keep(file, line)) {
          hits.push(`${file}:${index + 1}`)
        }
      })
    }
    expect(scanned).toBeGreaterThan(300)
    return hits
  }

  test("backend says Sadar Bersuara only", async () => {
    const hits = await scan(/suara[^a-z]{0,3}madani/i, (file, line) =>
      Boolean(kept[file]?.some((fragment) => line.includes(fragment))),
    )
    expect(hits).toEqual([])
  })

  // Roles, env, cookies, prefixes
  test("backend abbreviation is sb", async () => {
    const hits = await scan(
      /\bsm(?:[_.-][a-z]|\\[._])|\bSM_[A-Z]|__(Host|Secure)-sm\b|"sm"/,
      // Frontend draft key, documented
      (_file, line) => line.includes("sm.report-draft"),
    )
    expect(hits).toEqual([])
  })

  // Bun only, no npm
  test("backend runs Bun, not npm", async () => {
    const hits = await scan(
      /\bnpx\s|\bnpm\s+(install|i|ci|run|exec|view|info|test)\b/,
      // Quoted third-party README
      (_file, line) => line.includes("Opt out with"),
    )
    expect(hits).toEqual([])
  })

  // Bins carry node shebangs
  test("--bun on every bunx", async () => {
    const hits = await scan(
      /\bbunx\s+(?!--bun\b)/,
      // Recorded audit evidence
      (file, line) =>
        file === "docs/nfr-audit.md" && line.includes("'bunx biome explain"),
    )
    expect(hits).toEqual([])
  })

  test("package scripts run bins on the Bun runtime", async () => {
    const { scripts } = await readJson("package.json")
    const names = new Set(Object.keys(scripts))
    const bins = new Set(await readdir(join(root, "node_modules/.bin")))
    const hits = Object.entries(scripts as Record<string, string>).flatMap(
      ([name, script]) =>
        script.split(/&&|\|\||;/).flatMap((part) => {
          const words = part
            .trim()
            .split(/\s+/)
            .filter((word) => !/^[A-Z_]+=/.test(word))
          const [first = "", flag, target = ""] = words
          if (bins.has(first)) return [`${name}: ${first} on node`]
          // bun <name> prefers the script
          if (first === "bun" && flag === "--bun" && names.has(target)) {
            return [`${name}: bun --bun ${target} runs a script`]
          }
          return []
        }),
    )
    expect(hits).toEqual([])
  })
})

describe("tsconfig", () => {
  test("each path alias has one target", async () => {
    const { compilerOptions } = await readJson("tsconfig.json")
    for (const targets of Object.values(
      compilerOptions.paths as Record<string, string[]>,
    )) {
      expect(targets).toHaveLength(1)
    }
  })
})

async function matches(pattern: string): Promise<boolean> {
  for await (const _ of new Bun.Glob(pattern).scan({ cwd: root })) return true
  return false
}

describe("dead config references", () => {
  test("knip entry and project patterns match files", async () => {
    const { knip } = await readJson("package.json")
    for (const pattern of [...knip.entry, ...knip.project]) {
      expect({ pattern, found: await matches(pattern) }).toEqual({
        pattern,
        found: true,
      })
    }
  })

  test("configs name no removed folders", async () => {
    const configs = [
      "package.json",
      "tsconfig.json",
      "biome.json",
      ".dockerignore",
    ]
    for (const config of configs) {
      const text = await Bun.file(join(root, config)).text()
      // e2e/ exists now, mockup not
      expect({ config, hit: /suarakm-web/.test(text) }).toEqual({
        config,
        hit: false,
      })
    }
  })

  test("every .env.example key has a reader", async () => {
    const env = await Bun.file(join(root, ".env.example")).text()
    const keys = [...env.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1])
    const sources: string[] = []
    const glob = new Bun.Glob("{app,server,worker,db,shared}/**/*.{ts,tsx}")
    for await (const file of glob.scan({ cwd: root })) {
      if (file.startsWith("app/paraglide/")) continue
      sources.push(await Bun.file(join(root, file)).text())
    }
    sources.push(await Bun.file(join(root, "infra/compose.dev.yaml")).text())
    const corpus = sources.join("\n")
    const unread = keys.filter(
      (key) => key && !new RegExp(`\\b${key}\\b`).test(corpus),
    )
    expect(unread).toEqual([])
  })
})

// OWASP A03: supply chain
describe("supply chain", () => {
  test("actions and images pinned by digest", async () => {
    // SC-07: convention becomes a gate
    const loose: string[] = []
    const scan = async (pattern: string, check: (line: string) => boolean) => {
      for await (const file of new Bun.Glob(pattern).scan({ cwd: root })) {
        const lines = (await Bun.file(join(root, file)).text()).split("\n")
        lines.forEach((line, i) => {
          if (!check(line)) loose.push(`${file}:${i + 1}`)
        })
      }
    }
    const action = /^\s*(- )?uses:\s*(\S+)/
    await scan(".github/workflows/*.yml", (line) => {
      const ref = action.exec(line)?.[2]
      return !ref || ref.startsWith("./") || /@[0-9a-f]{40}$/.test(ref)
    })
    const image = /^\s*image:\s*(\S+)/
    await scan("infra/compose*.yaml", (line) => {
      const ref = image.exec(line)?.[1]
      // Own images: digest from deploy.sh
      return !ref || ref.startsWith("${") || /@sha256:[0-9a-f]{64}$/.test(ref)
    })
    const stages = new Set<string>()
    await scan("infra/*Dockerfile", (line) => {
      const from = /^FROM\s+(\S+)(?:\s+AS\s+(\S+))?/i.exec(line)
      if (!from?.[1]) return true
      const pinned =
        stages.has(from[1]) || /@sha256:[0-9a-f]{64}$/.test(from[1])
      if (from[2]) stages.add(from[2])
      return pinned
    })
    const literal = /\b[a-z0-9.-]+(?:\/[a-z0-9._-]+)+:[0-9][\w.-]*/g
    await scan("infra/*.sh", (line) =>
      [...line.matchAll(literal)].every((m) =>
        line.slice((m.index ?? 0) + m[0].length).startsWith("@sha256:"),
      ),
    )
    expect(loose).toEqual([])
  })

  test("no dependency install scripts run", async () => {
    const { trustedDependencies } = await readJson("package.json")
    expect(trustedDependencies).toEqual([])
    // Frozen lockfile ignores empty list
    const installs: string[] = []
    for (const file of [".github/workflows/ci.yml", "infra/Dockerfile"]) {
      const text = await Bun.file(join(root, file)).text()
      installs.push(...(text.match(/bun (?:install|ci)\b[^\n]*/g) ?? []))
    }
    expect(installs.length).toBeGreaterThan(4)
    expect(
      installs.filter((line) => !line.includes("--ignore-scripts")),
    ).toEqual([])
  })

  test("sample data stays out of the image", async () => {
    const patterns = (await Bun.file(join(root, ".dockerignore")).text())
      .split("\n")
      .filter((line) => line && !line.startsWith("#") && !line.startsWith("!"))
    const files: string[] = []
    for (const pattern of ["db/seed/sample*.ts", "worker/fixtures.ts"]) {
      for await (const file of new Bun.Glob(pattern).scan({ cwd: root })) {
        if (!file.endsWith(".test.ts")) files.push(file)
      }
    }
    const shipped = files.filter(
      (file) => !patterns.some((p) => new Bun.Glob(p).match(file)),
    )
    expect(files.length).toBeGreaterThan(4)
    expect(shipped).toEqual([])
    // Image steps run these
    for (const kept of ["db/seed/regions.ts", "db/seed/organizations.ts"]) {
      expect(patterns.some((p) => new Bun.Glob(p).match(kept))).toBe(false)
    }
  })
})
