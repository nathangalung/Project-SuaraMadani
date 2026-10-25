import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  acceptanceReport,
  isTestFile,
  main,
  parseScenarios,
  planCiteProblems,
  SHELL_TESTS,
  shellTags,
  taggedTests,
  unbalanced,
} from "./acceptance-gate.ts"

const root = join(import.meta.dir, "..")

const scenario = (id: string, extra = "") => `### ${id} Title
Source: PLAN.md §5.7 line 10
- Given a campus
- When a citizen rates
- Then one rating is stored
${extra}`

const docs = (...ids: string[]) =>
  `# Acceptance\n\n## Scenarios\n\n${ids.map((id) => scenario(id)).join("\n")}`

describe("scenario docs", () => {
  test("headings with source and Given, When, Then parse", () => {
    const parsed = parseScenarios(docs("AC-API-01", "AC-API-02"))
    expect(parsed.ids).toEqual(["AC-API-01", "AC-API-02"])
    expect(parsed.problems).toEqual([])
  })

  test("the format placeholder is not a scenario", () => {
    const text = "## Format\n\n### AC-<AREA>-<NN> Short title\n"
    expect(parseScenarios(text)).toEqual({ ids: [], outside: [], problems: [] })
  })

  test("headings inside code fences are ignored", () => {
    const text = `\`\`\`md\n${scenario("AC-API-01")}\`\`\`\n`
    expect(parseScenarios(text).ids).toEqual([])
  })

  test("a malformed or duplicate ID fails", () => {
    expect(parseScenarios(docs("AC-api-1")).problems).toEqual([
      "malformed scenario heading: ### AC-api-1 Title",
    ])
    expect(parseScenarios(docs("AC-API-01", "AC-API-01")).problems).toEqual([
      "duplicate scenario AC-API-01",
    ])
  })

  test("a scenario heading at the wrong level or escaped fails", () => {
    const text = `## Scenarios

${scenario("AC-API-02")}
#### AC-API-01 four hashes
###AC-API-04 no space
### \\[AC-API-03] escaped
## AC-API-05 two hashes
`
    const parsed = parseScenarios(text)
    expect(parsed.ids).toEqual(["AC-API-02"])
    expect(parsed.problems).toEqual([
      "malformed scenario heading: #### AC-API-01 four hashes",
      "malformed scenario heading: ###AC-API-04 no space",
      "malformed scenario heading: ### \\[AC-API-03] escaped",
      "malformed scenario heading: ## AC-API-05 two hashes",
    ])
  })

  test("missing source or steps out of order fails", () => {
    const text = `### AC-API-01 Title
- When a citizen rates
- Given a campus
`
    expect(parseScenarios(text).problems).toEqual([
      "AC-API-01 has no Source: line",
      "AC-API-01 needs Given, When, Then in order",
    ])
  })

  test("And and But lines may follow any step", () => {
    const text = scenario("AC-API-01", "- And it is audited\n")
    expect(parseScenarios(text).problems).toEqual([])
  })

  test("pre-launch checks are parsed apart", () => {
    const outside = (id: string, checked: string) =>
      `### ${id} Title\nSource: PLAN.md §13 line 1\n${checked}- Given a server\n- When a drill runs\n- Then it passes\n`
    const text = `${docs("AC-API-01")}\n## Pre-Launch Checks\n\n${outside(
      "AC-LOAD-01",
      "Checked by: infra/load-test.js, local only\n",
    )}${outside("AC-EDGE-01", "")}\n## Notes\n\n${scenario("AC-API-02")}`
    expect(parseScenarios(text)).toEqual({
      ids: ["AC-API-01", "AC-API-02"],
      outside: ["AC-LOAD-01", "AC-EDGE-01"],
      problems: ["AC-EDGE-01 has no Checked by: line"],
    })
  })

  test("an ID repeated in or after Pre-Launch Checks fails", () => {
    const check = `### AC-LOAD-01 Title\nSource: PLAN.md §13 line 1\nChecked by: infra/load-test.js\n- Given a server\n- When a drill runs\n- Then it passes\n`
    const prelaunch = (...blocks: string[]) =>
      `${docs("AC-API-01")}\n## Pre-Launch Checks\n\n${blocks.join("\n")}`
    const expected = {
      ids: ["AC-API-01"],
      outside: ["AC-LOAD-01"],
      problems: ["duplicate scenario AC-LOAD-01"],
    }
    expect(parseScenarios(prelaunch(check, check))).toEqual(expected)
    expect(
      parseScenarios(
        `${prelaunch(check)}\n## Notes\n\n${scenario("AC-LOAD-01")}`,
      ),
    ).toEqual(expected)
    expect(
      parseScenarios(
        `${docs("AC-API-01", "AC-LOAD-01")}\n## Pre-Launch Checks\n\n${check}`,
      ),
    ).toEqual({
      ids: ["AC-API-01", "AC-LOAD-01"],
      outside: [],
      problems: ["duplicate scenario AC-LOAD-01"],
    })
  })

  test("Out of Scope holds no scenario IDs", () => {
    const text = `${docs("AC-API-01")}\n## Out of Scope\n\n${scenario("AC-UI-01")}`
    const parsed = parseScenarios(text)
    expect(parsed.ids).toEqual(["AC-API-01"])
    expect(parsed.problems).toEqual(["AC-UI-01 is listed under Out of Scope"])
  })
})

describe("tagged tests in source", () => {
  const titles = (source: string) =>
    taggedTests(source).map(({ title, counted }) => ({ title, counted }))

  test("a plain test and it count", () => {
    const source = `
test("[AC-API-01] Given x, when y, then z", () => {})
it(
  "[AC-API-02] wrapped title",
  async () => {},
)
`
    expect(titles(source)).toEqual([
      { title: "[AC-API-01] Given x, when y, then z", counted: true },
      { title: "[AC-API-02] wrapped title", counted: true },
    ])
  })

  test("skip, todo, fixme and conditional modifiers do not count", () => {
    const source = `
test.skip("[AC-API-01] a", () => {})
test.todo("[AC-API-02] b")
test.fixme("[AC-API-03] c", () => {})
test.skipIf(slow)("[AC-API-04] d", () => {})
test.if(fast)("[AC-API-05] e", () => {})
it.failing("[AC-API-06] f", () => {})
`
    expect(titles(source).map((t) => t.counted)).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
    ])
  })

  test("commented out tests are not seen", () => {
    const source = `
// test("[AC-API-01] a", () => {})
/* test("[AC-API-02] b", () => {}) */
`
    expect(titles(source)).toEqual([])
  })

  test("tests under a skipped describe do not count", () => {
    const source = `
describe.skip("group", () => {
  test("[AC-API-01] a", () => {})
})
test.describe.fixme("group", () => {
  test("[AC-API-02] b", () => {})
})
describe("live", () => {
  test("[AC-API-03] c", () => {})
})
`
    expect(titles(source).map((t) => t.counted)).toEqual([false, false, true])
  })

  test("a skip statement inside a test or describe disables it", () => {
    const source = `
test("[AC-API-01] a", ({}, info) => {
  test.skip(info.project.name === "phone", "desktop only")
})
test.describe("group", () => {
  test.fixme()
  test("[AC-API-02] b", () => {})
})
test("[AC-API-03] c", () => {})
`
    expect(titles(source).map((t) => t.counted)).toEqual([false, false, true])
  })

  test("a skip statement in a nested describe disables only that describe", () => {
    const source = `
test.describe("outer", () => {
  test("[AC-API-01] a", () => {})
  test.describe("inner", () => {
    test.fixme()
    test("[AC-API-02] b", () => {})
  })
  test("[AC-API-03] c", () => {})
})
`
    expect(titles(source).map((t) => t.counted)).toEqual([true, false, true])
  })

  test("each tables and template titles count", () => {
    const source = `
test.each([1, 2])("[AC-API-01] row %d", (n) => {})
test(\`[AC-API-02] \${name} works\`, () => {})
`
    expect(titles(source)).toEqual([
      { title: "[AC-API-01] row %d", counted: true },
      { title: "[AC-API-02] * works", counted: true },
    ])
  })

  test("x-prefixed tests and describes do not count", () => {
    const source = `
xdescribe("group", () => {
  test("[AC-API-01] a", () => {})
})
xtest("[AC-API-02] b", () => {})
xit("[AC-API-03] c", () => {})
test("[AC-API-04] d", () => {})
`
    expect(titles(source)).toEqual([
      { title: "[AC-API-01] a", counted: false },
      { title: "[AC-API-02] b", counted: false },
      { title: "[AC-API-03] c", counted: false },
      { title: "[AC-API-04] d", counted: true },
    ])
  })

  test("tests registered under a condition do not count", () => {
    const source = `
if (process.env.SLOW) {
  test("[AC-API-01] a", () => {})
}
if (ready) test("[AC-API-02] b", () => {})
else {
  describe("group", () => {
    test("[AC-API-03] c", () => {})
  })
}
const t = fast ? test("[AC-API-04] d", () => {}) : null
describe("live", () => {
  for (const row of rows) {
    test(\`[AC-API-05] \${row}\`, () => {})
  }
  if (x) step()
  test("[AC-API-06] f", () => {})
})
`
    expect(titles(source).map((t) => t.counted)).toEqual([
      false,
      false,
      false,
      false,
      false,
      true,
    ])
  })

  test("tests Bun may never register do not count", () => {
    const source = `
describe("live only", () => {
  if (!process.env.LIVE) return
  test("[AC-API-01] after a return", () => {})
})
function later() {
  test("[AC-API-02] in a helper", () => {})
}
const soon = () => test("[AC-API-03] in an arrow", () => {})
for (const x of []) {
  test("[AC-API-04] in a loop", () => {})
}
while (false) {
  test("[AC-API-05] in a while", () => {})
}
try {
  run()
} catch {
  test("[AC-API-06] in a catch", () => {})
}
for (const x of rows) test("[AC-API-07] unbraced loop", () => {})
const NONE = []
test.each(NONE)("[AC-API-08] named table %s", () => {})
describe("guarded block", () => {
  if (!ready) {
    return
  }
  test("[AC-API-09] after a guarded return", () => {})
})
`
    expect(titles(source).filter((t) => t.counted)).toEqual([])
    expect(titles(source)).toHaveLength(9)
  })

  test("tests in describe and test callbacks still count", () => {
    const source = `
describe("outer", () => {
  const helper = () => {
    return 1
  }
  function local() {
    return 2
  }
  describe("inner", function () {
    test("[AC-API-01] nested", () => {})
  })
  test("[AC-API-02] after helpers", () => {
    return
  })
})
describe("arrow body", () => test("[AC-API-03] expression body", () => {}))
test.each([[1, 2]])("[AC-API-04] table %d", () => {})
test.describe("playwright", () => {
  test("[AC-API-05] spec", async ({ page }) => {})
})
`
    expect(titles(source).map((t) => t.counted)).toEqual([
      true,
      true,
      true,
      true,
      true,
    ])
  })

  test("an each over an empty table does not count", () => {
    const source = `
test.each([])("[AC-API-01] none %s", () => {})
test.each([1])("[AC-API-02] one %s", () => {})
`
    expect(titles(source).map((t) => t.counted)).toEqual([false, true])
  })

  test("strings, regexes and method calls are not tests", () => {
    const source = `
const fixture = \`test("[AC-API-01] a", () => {})\`
const quoted = 'test("[AC-API-02] b")'
const re = /test\\("[AC-API-03]/g
if (/x/.test("[AC-API-04]")) step()
await test.step("[AC-API-05] inner", async () => {})
const heifTest = test.skipIf(!hasHeif)
heifTest("[AC-API-06] alias", () => {})
`
    expect(titles(source)).toEqual([])
  })

  test("division is not read as a regex", () => {
    const source = `
const half = total / 2 / 1
test("[AC-API-01] after division", () => {})
`
    expect(titles(source)).toEqual([
      { title: "[AC-API-01] after division", counted: true },
    ])
  })

  test("an unclosed regex is read as division", () => {
    expect(titles(`test("[AC-API-01] x", () => {})\nconst r = /open`)).toEqual([
      { title: "[AC-API-01] x", counted: true },
    ])
  })

  test("a cut off or unbalanced file is reported", () => {
    expect(unbalanced(`test("[AC-API-02] cut", () => {`)).toBe(true)
    expect(unbalanced(`describe("a", () => {})\n})`)).toBe(true)
    expect(unbalanced(`test("a", () => { ])`)).toBe(true)
    expect(unbalanced(`test("a", () => { const b = [1, (2)] })`)).toBe(false)
  })

  test("a regex after an if header is a regex", () => {
    const source = `
describe.skip("d", () => {
  test("[AC-API-01] a", () => { if (s) /\\}\\)/.test(s) })
  test("[AC-API-02] b", () => {})
})
`
    expect(unbalanced(source)).toBe(false)
    expect(titles(source).map((t) => t.counted)).toEqual([false, false])
  })

  test("shell checks carry tags line by line", () => {
    const source = `
check "[AC-STACK-01] healthz through caddy" "$(get x)" "200"
# check "[AC-STACK-02] commented" "a" "a"
  check "[AC-STACK-03] indented" \\
    "$(get y)" "404"
check "plain" "a" "a"
`
    expect(shellTags(source)).toEqual([
      { title: "[AC-STACK-01] healthz through caddy", counted: true },
      { title: "[AC-STACK-03] indented", counted: true },
    ])
  })

  test("every shell test the gate reads runs in CI", async () => {
    const ci = await Bun.file(join(root, ".github/workflows/ci.yml")).text()
    expect(SHELL_TESTS.length).toBeGreaterThan(0)
    for (const script of SHELL_TESTS) expect(ci).toContain(`run: ${script} `)
  })

  test("only test and e2e files are scanned", () => {
    expect(isTestFile("server/app.test.ts")).toBe(true)
    expect(isTestFile("e2e/api.e2e.ts")).toBe(true)
    expect(isTestFile("app/routes/home.test.tsx")).toBe(false)
    expect(isTestFile("e2e/api-fixtures.ts")).toBe(false)
  })
})

describe("PLAN citations", () => {
  const plan = [
    "# Plan",
    "## 5. Konsep",
    "### 5.1 Alur",
    "satu",
    "",
    "dua",
    "### 5.2 Entitas",
    "tiga",
    "## 6. Halaman",
    "empat",
  ].join("\n")
  const cite = (text: string) => `### AC-API-01 T\n\nSource: ${text}\n`

  test("lines inside the named section pass", () => {
    const text = cite(
      "PLAN.md §5.1, lines 4 and 6; PLAN.md §5 (Konsep), lines 4-8; PLAN.md §6 item 1, line 10",
    )
    expect(planCiteProblems(text, plan)).toEqual([])
  })

  test("a blank line, a line in another section and a missing section fail", () => {
    const text = cite(
      "PLAN.md §5.1, line 5; PLAN.md §5.2, lines 6-8; PLAN.md §6, line 11; PLAN.md §7, line 4",
    )
    expect(planCiteProblems(text, plan)).toEqual([
      "docs/acceptance.md:3: PLAN.md line 5 is blank",
      "docs/acceptance.md:3: PLAN.md line 6 is outside §5.2",
      "docs/acceptance.md:3: PLAN.md line 11 is outside §6",
      "docs/acceptance.md:3: PLAN.md has no §7",
    ])
  })

  test("the example inside a code fence is not checked", () => {
    const text = "```md\nSource: PLAN.md §5.7, line 1234\n```\n"
    expect(planCiteProblems(text, plan)).toEqual([])
  })
})

describe("acceptance threshold", () => {
  const scenarioIds = (length: number) =>
    Array.from({ length }, (_, i) => `AC-API-${String(i + 1).padStart(2, "0")}`)
  const ids = scenarioIds(40)
  const tagsOf = (list: string[], count: number) =>
    list.slice(0, count).map((id) => ({
      file: "server/api.test.ts",
      title: `[${id}] t`,
      counted: true,
    }))
  const tags = (count: number) => tagsOf(ids, count)

  test("99 of 100 automated passes, 98 fails", () => {
    const hundred = scenarioIds(100)
    expect(acceptanceReport(hundred, tagsOf(hundred, 99)).problems).toEqual([])
    expect(acceptanceReport(hundred, tagsOf(hundred, 98)).problems).toEqual([
      "automated 98 of 100 scenarios (98%) < 99%",
    ])
  })

  test("99% passes and 98.99% fails", () => {
    const many = scenarioIds(10000)
    const at = (count: number) => acceptanceReport(many, tagsOf(many, count))
    expect(at(9900)).toMatchObject({ percent: 99, problems: [] })
    expect(at(9899).problems).toEqual([
      "automated 9899 of 10000 scenarios (98.99%) < 99%",
    ])
  })

  test("98.995% fails though it prints as 99%", () => {
    const many = scenarioIds(20000)
    expect(acceptanceReport(many, tagsOf(many, 19799)).problems).toEqual([
      "automated 19799 of 20000 scenarios (99%) < 99%",
    ])
  })

  test("39 of 40 automated, 97.5%, now fails", () => {
    expect(acceptanceReport(ids, tags(39)).problems).toEqual([
      "automated 39 of 40 scenarios (97.5%) < 99%",
    ])
  })

  test("a skipped tagged test leaves its scenario open", () => {
    const report = acceptanceReport(
      ["AC-API-01"],
      [{ file: "server/api.test.ts", title: "[AC-API-01] t", counted: false }],
    )
    expect(report.automated).toBe(0)
    expect(report.open).toEqual(["AC-API-01"])
  })

  test("an ID the docs do not define fails", () => {
    const report = acceptanceReport(ids, [
      ...tags(40),
      { file: "server/api.test.ts", title: "[AC-API-99] t", counted: false },
      { file: "e2e/api.e2e.ts", title: "[AC-api-1] t", counted: true },
    ])
    expect(report.problems).toEqual([
      "server/api.test.ts: AC-API-99 is not in docs/acceptance.md",
      "e2e/api.e2e.ts: AC-api-1 is not in docs/acceptance.md",
    ])
  })

  test("outside scenarios are defined but not in the share", () => {
    const report = acceptanceReport(
      ["AC-API-01"],
      [
        { file: "server/api.test.ts", title: "[AC-API-01] t", counted: true },
        { file: "infra/x.test.ts", title: "[AC-LOAD-01] t", counted: true },
      ],
      ["AC-LOAD-01", "AC-EDGE-01"],
    )
    expect(report).toMatchObject({
      scenarios: 1,
      automated: 1,
      percent: 100,
      open: [],
      outside: 2,
      problems: [],
    })
  })

  test("three pre-launch checks pass, a fourth fails, and the share with them is reported", () => {
    const tagged = [
      { file: "server/api.test.ts", title: "[AC-API-01] t", counted: true },
    ]
    const three = acceptanceReport(["AC-API-01"], tagged, [
      "AC-A-01",
      "AC-B-01",
      "AC-C-01",
    ])
    expect(three.problems).toEqual([])
    expect(three.withOutside).toBe(25)
    const four = acceptanceReport(["AC-API-01"], tagged, [
      "AC-A-01",
      "AC-B-01",
      "AC-C-01",
      "AC-D-01",
    ])
    expect(four.problems).toEqual([
      "4 scenarios under Pre-Launch Checks, at most 3",
    ])
  })

  test("zero scenarios fails", () => {
    expect(acceptanceReport([], []).problems).toEqual([
      "docs/acceptance.md defines no scenarios",
    ])
  })
})

describe("command line", () => {
  let dir = ""
  const files = ["docs/acceptance.md", "server/a.test.ts", "e2e/b.e2e.ts"]

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "sb-acceptance-gate-"))
    await mkdir(join(dir, "docs"))
    await mkdir(join(dir, "server"))
    await mkdir(join(dir, "e2e"))
    await Bun.write(join(dir, "docs/acceptance.md"), docs("AC-API-01"))
    await Bun.write(
      join(dir, "e2e/b.e2e.ts"),
      `test("[AC-API-01] Given, when, then", () => {})\n`,
    )
  })
  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true })
  })

  test("an automated scenario exits 0", async () => {
    await Bun.write(join(dir, "server/a.test.ts"), "")
    expect(await main([], dir, () => files)).toBe(0)
  })

  test("its only test skipped exits 1", async () => {
    await Bun.write(
      join(dir, "e2e/b.e2e.ts"),
      `test.skip("[AC-API-01] Given, when, then", () => {})\n`,
    )
    expect(await main([], dir, () => files)).toBe(1)
  })

  test("trace prints the test per scenario", async () => {
    await Bun.write(
      join(dir, "server/a.test.ts"),
      `test("[AC-API-01] traced", () => {})\n`,
    )
    const lines: string[] = []
    const log = console.log
    console.log = (line: string) => lines.push(line)
    try {
      expect(await main(["--trace"], dir, () => files)).toBe(0)
    } finally {
      console.log = log
    }
    expect(lines).toContain(
      "AC-API-01\tserver/a.test.ts\t[AC-API-01] traced\tcounted",
    )
    expect(lines).toContain(
      "AC-API-01\te2e/b.e2e.ts\t[AC-API-01] Given, when, then\tnot counted",
    )
  })

  test("a tagged check in the stack or deploy test counts", async () => {
    await Bun.write(join(dir, "e2e/b.e2e.ts"), "")
    await Bun.write(join(dir, "server/a.test.ts"), "")
    for (const script of ["infra/stack-test.sh", "infra/deploy-test.sh"]) {
      await mkdir(join(dir, script, ".."), { recursive: true })
      await Bun.write(
        join(dir, script),
        `check "[AC-API-01] through caddy" "a" "a"\n`,
      )
      expect(await main([], dir, () => [...files, script])).toBe(0)
      expect(await main([], dir, () => files)).toBe(1)
    }
  })

  test("an unbalanced test file exits 1 and names the file", async () => {
    await Bun.write(join(dir, "e2e/b.e2e.ts"), "")
    await Bun.write(
      join(dir, "server/a.test.ts"),
      `test("[AC-API-01] cut", () => {\n`,
    )
    const errors: string[] = []
    const error = console.error
    console.error = (line: string) => errors.push(line)
    try {
      expect(await main([], dir, () => files)).toBe(1)
    } finally {
      console.error = error
    }
    expect(errors).toContain("server/a.test.ts: unbalanced brackets")
  })

  test("the real Pre-Launch Checks hold the three agreed", async () => {
    const parsed = parseScenarios(
      await Bun.file(join(root, "docs/acceptance.md")).text(),
    )
    expect(parsed.outside).toEqual([
      "AC-LOAD-01",
      "AC-EDGE-01",
      "AC-RESTORE-01",
    ])
    expect(parsed.ids).not.toContain("AC-RESTORE-01")
    expect(parsed.problems).toEqual([])
  })

  test("a blank cited PLAN line exits 1 and names it", async () => {
    await Bun.write(join(dir, "e2e/b.e2e.ts"), "")
    await Bun.write(
      join(dir, "server/a.test.ts"),
      `test("[AC-API-01] cited", () => {})\n`,
    )
    await Bun.write(join(dir, "PLAN.md"), "# Plan\n\n## 5. Konsep\n\nIsi\n")
    const cited = (line: number) =>
      docs("AC-API-01").replace(
        "Source: PLAN.md §5.7 line 10",
        `Source: PLAN.md §5, line ${line}`,
      )
    const errors: string[] = []
    const error = console.error
    console.error = (line: string) => errors.push(line)
    try {
      await Bun.write(join(dir, "docs/acceptance.md"), cited(5))
      expect(await main([], dir, () => files)).toBe(0)
      await Bun.write(join(dir, "docs/acceptance.md"), cited(4))
      expect(await main([], dir, () => files)).toBe(1)
    } finally {
      console.error = error
      await rm(join(dir, "PLAN.md"))
      await Bun.write(join(dir, "docs/acceptance.md"), docs("AC-API-01"))
    }
    expect(errors).toEqual(["docs/acceptance.md:6: PLAN.md line 4 is blank"])
  })

  test("the real docs cite PLAN lines inside their sections", async () => {
    const text = (file: string) => Bun.file(join(root, file)).text()
    expect(
      planCiteProblems(await text("docs/acceptance.md"), await text("PLAN.md")),
    ).toEqual([])
  })

  test("a missing docs file exits 1", async () => {
    expect(await main([], join(dir, "server"), () => [])).toBe(1)
  })

  test("the gate's own tests carry no tags", async () => {
    const source = await Bun.file(
      join(import.meta.dir, "acceptance-gate.test.ts"),
    ).text()
    expect(taggedTests(source)).toEqual([])
  })
})
