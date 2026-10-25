// Acceptance scenario gate, ADR-24
// Usage: bun acceptance-gate.ts [--trace]

import { existsSync } from "node:fs"
import { join } from "node:path"
import { repoFiles } from "./coverage-gate.ts"

type Token = { type: "name" | "string" | "punct" | "other"; value: string }

export type Tag = { file: string; title: string; counted: boolean }

export type Report = {
  scenarios: number
  automated: number
  percent: number
  open: string[]
  // Checked outside, not counted
  outside: number
  // Share with outside counted open
  withOutside: number
  problems: string[]
}

const AGGREGATE_BP = 9900
// User decision, 22 October 2026
const MAX_PRE_LAUNCH = 3
const DOCS = "docs/acceptance.md"
const SCENARIO = /^###\s+(AC-[A-Z][A-Z0-9]*-\d{2,})(?:\s|$)/
// Loose, so typos surface
const TAG = /\[(AC-[^\]\s]*)\]/g
// Run by CI, test checks
export const SHELL_TESTS = ["infra/stack-test.sh", "infra/deploy-test.sh"]
const SHELL_CHECK = /^\s*check\s+"(\[AC-[^"]*)"/

// Previous token allows a regex
const BEFORE_REGEX = new Set("(,=:[!&|?{};+-*%<>~^".split(""))
// Headers whose body may follow
const HEADERS = new Set(["if", "for", "while", "switch", "catch"])
const KEYWORDS_BEFORE_REGEX = new Set(
  "return typeof instanceof in of new delete void throw case do else yield await".split(
    " ",
  ),
)

function readQuoted(source: string, start: number): [number, string] {
  const quote = source[start]
  let text = ""
  let i = start + 1
  while (i < source.length && source[i] !== quote && source[i] !== "\n") {
    if (source[i] === "\\") i++
    text += source[i] ?? ""
    i++
  }
  return [i + 1, text]
}

function readRegex(source: string, start: number): number | undefined {
  let inClass = false
  for (let i = start + 1; i < source.length; i++) {
    const c = source[i]
    if (c === "\n") return undefined
    if (c === "\\") i++
    else if (c === "[") inClass = true
    else if (c === "]") inClass = false
    else if (c === "/" && !inClass) {
      let end = i + 1
      while (/[a-z]/.test(source[end] ?? "")) end++
      return end
    }
  }
  return undefined
}

function readTemplate(source: string, start: number): [number, string] {
  let text = ""
  let i = start + 1
  while (i < source.length && source[i] !== "`") {
    if (source[i] === "\\") {
      text += source[i + 1] ?? ""
      i += 2
    } else if (source[i] === "$" && source[i + 1] === "{") {
      // Expressions stay opaque
      text += "*"
      i = lex(source, i + 2, true).end
    } else {
      text += source[i]
      i++
    }
  }
  return [i + 1, text]
}

/** Tokens, until an unmatched brace. */
function lex(
  source: string,
  start: number,
  untilBrace: boolean,
): { tokens: Token[]; end: number } {
  const tokens: Token[] = []
  let depth = 0
  let i = start
  // Open parens, last closed
  const parens: number[] = []
  let closed = -1
  const regexAllowed = () => {
    const prev = tokens.at(-1)
    if (!prev) return true
    if (prev.value === ")") return HEADERS.has(tokens[closed - 1]?.value ?? "")
    if (prev.type === "punct") return BEFORE_REGEX.has(prev.value)
    return prev.type === "name" && KEYWORDS_BEFORE_REGEX.has(prev.value)
  }
  while (i < source.length) {
    const c = source[i] ?? ""
    const next = source[i + 1]
    if (/\s/.test(c)) {
      i++
    } else if (c === "/" && next === "/") {
      const end = source.indexOf("\n", i)
      i = end < 0 ? source.length : end
    } else if (c === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2)
      i = end < 0 ? source.length : end + 2
    } else if (c === '"' || c === "'") {
      const [end, value] = readQuoted(source, i)
      tokens.push({ type: "string", value })
      i = end
    } else if (c === "`") {
      const [end, value] = readTemplate(source, i)
      tokens.push({ type: "string", value })
      i = end
    } else if (c === "/" && regexAllowed() && readRegex(source, i)) {
      tokens.push({ type: "other", value: "regex" })
      i = readRegex(source, i) ?? i + 1
    } else if (/[A-Za-z_$]/.test(c)) {
      const name = /^[\w$]+/.exec(source.slice(i, i + 200))?.[0] ?? c
      tokens.push({ type: "name", value: name })
      i += name.length
    } else if (/[0-9]/.test(c)) {
      const num = /^[\w.]+/.exec(source.slice(i, i + 100))?.[0] ?? c
      tokens.push({ type: "other", value: num })
      i += num.length
    } else {
      if (untilBrace && c === "{") depth++
      if (untilBrace && c === "}" && depth-- === 0)
        return { tokens, end: i + 1 }
      if (c === "(") parens.push(tokens.length)
      if (c === ")") closed = parens.pop() ?? -1
      tokens.push({ type: "punct", value: c })
      i++
    }
  }
  return { tokens, end: i }
}

const OPEN = new Set(["(", "[", "{"])
const CLOSE = new Set([")", "]", "}"])
const PAIR: Record<string, string> = { ")": "(", "]": "[", "}": "{" }

/** Misread or cut off source. */
export function unbalanced(source: string): boolean {
  const stack: string[] = []
  for (const token of lex(source, 0, false).tokens) {
    if (token.type !== "punct") continue
    if (OPEN.has(token.value)) stack.push(token.value)
    else if (CLOSE.has(token.value) && stack.pop() !== PAIR[token.value]) {
      return true
    }
  }
  return stack.length > 0
}

/** Index of the matching close. */
function matching(tokens: Token[], open: number): number {
  let depth = 0
  for (let i = open; i < tokens.length; i++) {
    const t = tokens[i]
    if (t?.type !== "punct") continue
    if (OPEN.has(t.value)) depth++
    if (CLOSE.has(t.value) && --depth === 0) return i
  }
  return tokens.length - 1
}

const DISABLING = new Set([
  "skip",
  "todo",
  "fixme",
  "skipIf",
  "todoIf",
  "if",
  "failing",
])
// Take a table, then args
const CURRIED = new Set(["each", "skipIf", "todoIf", "if"])
const TEST_MODIFIERS = new Set([
  ...DISABLING,
  ...CURRIED,
  "only",
  "serial",
  "concurrent",
])
const DESCRIBE_MODIFIERS = new Set([...TEST_MODIFIERS, "describe", "parallel"])

type Call = {
  kind: "test" | "describe" | "skip"
  title?: string
  disabled: boolean
  start: number
  end: number
}

// Bun's disabled aliases
const X_BASES: Record<string, "test" | "describe"> = {
  xtest: "test",
  xit: "test",
  xdescribe: "describe",
}
const BASES = new Set(["test", "it", "describe", ...Object.keys(X_BASES)])
// Tokens making a call conditional
const GUARDS = new Set(["?", ":", "&", "|", "else", "do"])
// Blocks run in place
const CONTROL_AFTER = new Set(["else", "try", "finally", "do"])

/** Bracket pairs and enclosing brackets. */
function nesting(tokens: Token[]): { openOf: number[]; parent: number[] } {
  const openOf: number[] = []
  const parent: number[] = []
  const stack: number[] = []
  tokens.forEach((token, i) => {
    if (token.type === "punct" && CLOSE.has(token.value)) {
      openOf[i] = stack.pop() ?? -1
    }
    parent[i] = stack.at(-1) ?? -1
    if (token.type === "punct" && OPEN.has(token.value)) stack.push(i)
  })
  return { openOf, parent }
}

function calls(tokens: Token[]): Call[] {
  const found: Call[] = []
  const { openOf, parent } = nesting(tokens)
  // Argument lists of describe calls
  const describeArgs = new Set<number>()
  const value = (at: number) => tokens[at]?.value ?? ""
  const header = (close: number) => value((openOf[close] ?? 0) - 1)
  const guarded = (at: number) => {
    const prev = value(at - 1)
    if (GUARDS.has(prev)) return true
    return prev === ")" && HEADERS.has(header(at - 1))
  }
  const controlBlock = (brace: number) => {
    const prev = value(brace - 1)
    if (CONTROL_AFTER.has(prev)) return true
    return prev === ")" && HEADERS.has(header(brace - 1))
  }
  const callbackBody = (brace: number) => {
    if (!describeArgs.has(parent[brace] ?? -1)) return false
    if (value(brace - 1) === ">" && value(brace - 2) === "=") return true
    if (value(brace - 1) !== ")") return false
    const open = openOf[brace - 1] ?? 0
    return value(open - 1) === "function" || value(open - 2) === "function"
  }
  // Early return in block
  const returnsBefore = (brace: number, at: number) => {
    for (let r = brace + 1; r < at; r++) {
      if (value(r) !== "return" || tokens[r]?.type !== "name") continue
      let p = parent[r] ?? -1
      while (p !== brace && p >= 0 && controlBlock(p)) p = parent[p] ?? -1
      if (p === brace) return true
    }
    return false
  }
  // Bun registers it on load
  const registered = (at: number) => {
    if (guarded(at)) return false
    const p = parent[at] ?? -1
    if (value(p) === "(") return describeArgs.has(p)
    // Arrow body runs later
    if (value(at - 1) === ">" && value(at - 2) === "=") return false
    if (p === -1) return true
    return value(p) === "{" && callbackBody(p) && !returnsBefore(p, at)
  }
  tokens.forEach((token, start) => {
    const base = token.value
    if (token.type !== "name" || !BASES.has(base)) return
    if (tokens[start - 1]?.value === ".") return
    const mods: string[] = []
    let i = start + 1
    while (tokens[i]?.value === "." && tokens[i + 1]?.type === "name") {
      mods.push(tokens[i + 1]?.value ?? "")
      i += 2
    }
    if (tokens[i]?.value !== "(") return
    const plain = X_BASES[base] ?? base
    const isDescribe = plain === "describe" || mods.includes("describe")
    const allowed = isDescribe ? DESCRIBE_MODIFIERS : TEST_MODIFIERS
    if (plain === "describe" && mods.includes("describe")) return
    if (!mods.every((mod) => allowed.has(mod))) return
    // Only a literal table rows
    const noRows =
      mods.includes("each") && !(value(i + 1) === "[" && value(i + 2) !== "]")
    let close = matching(tokens, i)
    if (mods.some((mod) => CURRIED.has(mod))) {
      // Alias, not a declaration
      if (tokens[close + 1]?.value !== "(") return
      i = close + 1
      close = matching(tokens, i)
    }
    if (isDescribe) describeArgs.add(i)
    const first = tokens[i + 1]
    const disabled =
      base in X_BASES ||
      noRows ||
      mods.some((mod) => DISABLING.has(mod)) ||
      !registered(start)
    const title = first?.type === "string" ? first.value : undefined
    const statement =
      !isDescribe &&
      title === undefined &&
      (mods.includes("skip") || mods.includes("fixme"))
    found.push({
      kind: statement ? "skip" : isDescribe ? "describe" : "test",
      title,
      disabled,
      start,
      end: close,
    })
  })
  return found
}

/** Tests with an ID tag. */
export function taggedTests(
  source: string,
): { title: string; counted: boolean }[] {
  const found = calls(lex(source, 0, false).tokens)
  const blocks = found.filter((call) => call.kind !== "skip")
  const inside = (outer: Call, inner: Call) =>
    outer !== inner && outer.start < inner.start && outer.end >= inner.end
  // Innermost block, or the file
  const skipped = new Set<Call | "file">()
  for (const skip of found.filter((call) => call.kind === "skip")) {
    const scope = blocks
      .filter((block) => inside(block, skip))
      .sort((a, b) => b.start - a.start)[0]
    skipped.add(scope ?? "file")
  }
  return found
    .filter((call) => call.kind === "test" && call.title?.includes("[AC-"))
    .map((call) => {
      const chain = [call, ...blocks.filter((block) => inside(block, call))]
      const counted =
        !skipped.has("file") &&
        chain.every((block) => !block.disabled && !skipped.has(block))
      return { title: call.title ?? "", counted }
    })
}

/** Shell checks with ID tags. */
export function shellTags(
  source: string,
): { title: string; counted: boolean }[] {
  return source.split("\n").flatMap((line) => {
    const title = SHELL_CHECK.exec(line)?.[1]
    return title ? [{ title, counted: true }] : []
  })
}

/** IDs per scenario heading. */
export function parseScenarios(text: string): {
  ids: string[]
  outside: string[]
  problems: string[]
} {
  const ids: string[] = []
  const outside: string[] = []
  const problems: string[] = []
  let fenced = false
  let outOfScope = false
  let inOutside = false
  let current: { id: string; lines: string[]; outside: boolean } | undefined
  const check = () => {
    if (!current) return
    const { id, lines } = current
    if (!lines.some((line) => /^Source:\s*\S/.test(line))) {
      problems.push(`${id} has no Source: line`)
    }
    if (
      current.outside &&
      !lines.some((line) => /^Checked by:\s*\S/.test(line))
    ) {
      problems.push(`${id} has no Checked by: line`)
    }
    const steps = lines
      .map((line) => /^- (Given|When|Then)\b/.exec(line)?.[1])
      .filter(Boolean)
    const at = (step: string) => steps.indexOf(step)
    const given = at("Given")
    if (!(given >= 0 && given < at("When") && at("When") < at("Then"))) {
      problems.push(`${id} needs Given, When, Then in order`)
    }
    current = undefined
  }
  for (const line of text.split("\n")) {
    if (/^\s*```/.test(line)) fenced = !fenced
    if (fenced) continue
    if (!line.startsWith("#")) {
      current?.lines.push(line)
      continue
    }
    check()
    if (/^##\s/.test(line)) {
      inOutside = /^##\s+Pre-Launch Checks\s*$/.test(line)
    }
    if (/^##\s+Out of Scope\s*$/.test(line)) outOfScope = true
    // Any heading naming an ID
    if (!/AC-[A-Za-z0-9]/.test(line)) continue
    const id = SCENARIO.exec(line)?.[1]
    if (!id) problems.push(`malformed scenario heading: ${line}`)
    else if (outOfScope) problems.push(`${id} is listed under Out of Scope`)
    else if (ids.includes(id) || outside.includes(id)) {
      problems.push(`duplicate scenario ${id}`)
    } else {
      if (inOutside) outside.push(id)
      else ids.push(id)
      current = { id, lines: [], outside: inOutside }
    }
  }
  check()
  return { ids, outside, problems }
}

const idsOf = (title: string) => [...title.matchAll(TAG)].map((m) => m[1])

/** No problems means passing. */
export function acceptanceReport(
  ids: string[],
  tags: Tag[],
  outside: string[] = [],
): Report {
  const problems: string[] = []
  if (ids.length === 0) problems.push(`${DOCS} defines no scenarios`)
  // Defined, never in the share
  const defined = new Set([...ids, ...outside])
  const unknown = new Set<string>()
  for (const tag of tags) {
    for (const id of idsOf(tag.title)) {
      if (id && !defined.has(id)) unknown.add(`${tag.file}: ${id}`)
    }
  }
  for (const line of unknown) problems.push(`${line} is not in ${DOCS}`)
  const automatedIds = new Set(
    tags.filter((tag) => tag.counted).flatMap((tag) => idsOf(tag.title)),
  )
  const open = ids.filter((id) => !automatedIds.has(id))
  const automated = ids.length - open.length
  const share = (of: number) =>
    of === 0 ? 0 : Math.round((automated / of) * 10000) / 100
  const percent = share(ids.length)
  if (ids.length > 0 && automated * 10000 < ids.length * AGGREGATE_BP) {
    problems.push(
      `automated ${automated} of ${ids.length} scenarios (${percent}%) < ${AGGREGATE_BP / 100}%`,
    )
  }
  if (outside.length > MAX_PRE_LAUNCH) {
    problems.push(
      `${outside.length} scenarios under Pre-Launch Checks, at most ${MAX_PRE_LAUNCH}`,
    )
  }
  return {
    scenarios: ids.length,
    automated,
    percent,
    open,
    outside: outside.length,
    withOutside: share(ids.length + outside.length),
    problems,
  }
}

const PLAN_CITE =
  /PLAN\.md §(\d+(?:\.\d+)*)[^,;]*, lines? (\d+(?:-\d+)?(?:(?:, | and )\d+(?:-\d+)?)*)/g
const PLAN_HEADING = /^(#{2,6})\s+(\d+(?:\.\d+)*)\.?\s/

/** Cited PLAN lines, in section. */
export function planCiteProblems(docs: string, plan: string): string[] {
  const lines = plan.split("\n")
  const heads = lines.flatMap((line, i) => {
    const m = PLAN_HEADING.exec(line)
    return m
      ? [{ at: i + 1, level: m[1]?.length ?? 0, number: m[2] ?? "" }]
      : []
  })
  const sections = new Map<string, [number, number]>()
  heads.forEach((head, i) => {
    const next = heads.slice(i + 1).find((h) => h.level <= head.level)
    sections.set(head.number, [head.at, next ? next.at - 1 : lines.length])
  })
  const problems: string[] = []
  let fenced = false
  docs.split("\n").forEach((row, i) => {
    if (/^\s*```/.test(row)) fenced = !fenced
    if (fenced) return
    for (const [, section = "", spec = ""] of row.matchAll(PLAN_CITE)) {
      const where = `${DOCS}:${i + 1}: PLAN.md`
      const range = sections.get(section)
      if (!range) {
        problems.push(`${where} has no §${section}`)
        continue
      }
      for (const n of (spec.match(/\d+/g) ?? []).map(Number)) {
        if (n <= range[0] || n > range[1]) {
          problems.push(`${where} line ${n} is outside §${section}`)
        } else if (!lines[n - 1]?.trim()) {
          problems.push(`${where} line ${n} is blank`)
        }
      }
    }
  })
  return problems
}

/** Bun tests and Playwright specs. */
export function isTestFile(file: string): boolean {
  return file.endsWith(".test.ts") || /^e2e\/[^/]+\.e2e\.ts$/.test(file)
}

/** Exit code, problems on stderr. */
export async function main(
  argv: string[],
  root = join(import.meta.dir, ".."),
  list: (root: string) => string[] = repoFiles,
): Promise<number> {
  const docs = join(root, DOCS)
  if (!existsSync(docs)) {
    console.error(`no ${DOCS} under ${root}`)
    return 1
  }
  const docsText = await Bun.file(docs).text()
  const parsed = parseScenarios(docsText)
  const planFile = join(root, "PLAN.md")
  const plan = existsSync(planFile) ? await Bun.file(planFile).text() : ""
  const tags: Tag[] = []
  const misread: string[] = []
  for (const file of list(root).filter(isTestFile).sort()) {
    const source = await Bun.file(join(root, file)).text()
    if (unbalanced(source)) misread.push(`${file}: unbalanced brackets`)
    for (const tag of taggedTests(source)) tags.push({ file, ...tag })
  }
  for (const file of list(root).filter((one) => SHELL_TESTS.includes(one))) {
    const source = await Bun.file(join(root, file)).text()
    for (const tag of shellTags(source)) tags.push({ file, ...tag })
  }
  const report = acceptanceReport(parsed.ids, tags, parsed.outside)
  const problems = [
    ...parsed.problems,
    ...planCiteProblems(docsText, plan),
    ...misread,
    ...report.problems,
  ]
  if (argv.includes("--trace")) {
    const rows = tags.flatMap((tag) =>
      idsOf(tag.title).map(
        (id) =>
          `${id}\t${tag.file}\t${tag.title}\t${tag.counted ? "counted" : "not counted"}`,
      ),
    )
    for (const row of rows.sort()) console.log(row)
  }
  for (const line of problems) console.error(line)
  if (report.open.length > 0) console.error(`open: ${report.open.join(", ")}`)
  console.log(
    JSON.stringify({
      msg: "acceptance-gate",
      scenarios: report.scenarios,
      automated: report.automated,
      percent: report.percent,
      open: report.open.length,
      outside: report.outside,
      withOutside: report.withOutside,
      problems: problems.length,
    }),
  )
  return problems.length > 0 ? 1 : 0
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2))
