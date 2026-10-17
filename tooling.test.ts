import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
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
    // Read inside the library
    const libraryRead = new Set(["BETTER_AUTH_SECRETS"])
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
      (key) =>
        key &&
        !libraryRead.has(key) &&
        !new RegExp(`\\b${key}\\b`).test(corpus),
    )
    expect(unread).toEqual([])
  })
})
