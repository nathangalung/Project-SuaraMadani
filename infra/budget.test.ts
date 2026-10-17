import { describe, expect, test } from "bun:test"

const dir = new URL("./", import.meta.url).pathname
const read = (name: string) => Bun.file(`${dir}${name}`).text()

type Service = { mem_limit?: string; cpus?: number | string }

// Docker units are binary
function mebibytes(limit: string): number {
  const match = /^(\d+)([mg])$/.exec(limit)
  if (!match) throw new Error(`unknown limit ${limit}`)
  return Number(match[1]) * (match[2] === "g" ? 1024 : 1)
}

async function services(): Promise<Record<string, Service>> {
  const compose = Bun.YAML.parse(await read("compose.yaml")) as {
    services: Record<string, Service>
  }
  return compose.services
}

describe("host RAM floor", () => {
  test("every service, restic included, has limits", async () => {
    const unbounded = Object.entries(await services())
      .filter(([, s]) => !s.mem_limit || s.cpus === undefined)
      .map(([name]) => name)
    expect(unbounded).toEqual([])
  })

  test("floor is every limit plus 1.5 GiB, in KiB", async () => {
    const total = Object.values(await services()).reduce(
      (sum, s) => sum + mebibytes(s.mem_limit ?? "0m"),
      0,
    )
    const floor = /^MIN_RAM_KB=(\d+)$/m.exec(await read("host-setup.sh"))
    expect(Number(floor?.[1])).toBe((total + 1536) * 1024)
  })
})

describe("database PITR window", () => {
  test("weekly fulls keep at least 2 weeks, PLAN §10", async () => {
    const conf = await read("pgbackrest.conf")
    const fulls = Number(/^repo1-retention-full=(\d+)$/m.exec(conf)?.[1])
    // Oldest point after a full
    expect((fulls - 1) * 7).toBeGreaterThanOrEqual(14)
    expect(await read("backup-db.sh")).toContain('date +%u)" == "7"')
  })
})
