import { describe, expect, test } from "bun:test"
import { readdir } from "node:fs/promises"
import { join } from "node:path"

// Drizzle skips out-of-order migrations
type Entry = { idx: number; when: number; tag: string }

const DIR = join(import.meta.dir, "migrations")

/** Order and file problems. */
function journalProblems(entries: Entry[], files: string[]): string[] {
  const problems: string[] = []
  entries.forEach((entry, i) => {
    if (entry.idx !== i) problems.push(`${entry.tag}: idx ${entry.idx}`)
    if (!entry.tag.startsWith(String(i).padStart(4, "0"))) {
      problems.push(`${entry.tag}: prefix`)
    }
    const prev = entries[i - 1]
    if (prev && entry.when <= prev.when) problems.push(`${entry.tag}: when`)
    if (!files.includes(`${entry.tag}.sql`)) {
      problems.push(`${entry.tag}: no file`)
    }
  })
  const tags = new Set(entries.map((entry) => `${entry.tag}.sql`))
  for (const file of files) {
    if (!tags.has(file)) problems.push(`${file}: not in journal`)
  }
  return problems
}

const ok: Entry[] = [
  { idx: 0, when: 10, tag: "0000_a" },
  { idx: 1, when: 20, tag: "0001_b" },
]

describe("journalProblems", () => {
  test("a sound journal passes", () => {
    expect(journalProblems(ok, ["0000_a.sql", "0001_b.sql"])).toEqual([])
  })

  test("an older timestamp after a newer one fails", () => {
    const late = [ok[0], { idx: 1, when: 5, tag: "0001_b" }] as Entry[]
    expect(journalProblems(late, ["0000_a.sql", "0001_b.sql"])).toEqual([
      "0001_b: when",
    ])
  })

  test("a gap in idx and prefix fails", () => {
    const gap = [ok[0], { idx: 2, when: 20, tag: "0002_b" }] as Entry[]
    expect(journalProblems(gap, ["0000_a.sql", "0002_b.sql"])).toEqual([
      "0002_b: idx 2",
      "0002_b: prefix",
    ])
  })

  test("files and entries must match", () => {
    expect(journalProblems(ok, ["0000_a.sql", "0002_c.sql"])).toEqual([
      "0001_b: no file",
      "0002_c.sql: not in journal",
    ])
  })
})

test("the real journal is in order", async () => {
  const journal = (await Bun.file(join(DIR, "meta/_journal.json")).json()) as {
    entries: Entry[]
  }
  const files = (await readdir(DIR)).filter((file) => file.endsWith(".sql"))
  expect(journalProblems(journal.entries, files)).toEqual([])
})
