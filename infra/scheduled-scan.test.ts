import { afterAll, describe, expect, test } from "bun:test"
import { chmod, cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const root = join(import.meta.dir, "..")
const dirs: string[] = []

afterAll(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true })
})

type Workflow = {
  jobs: Record<string, { steps: { name?: string; run?: string }[] }>
}

// upload-artifact refuses these
const REFUSED = /[":<>|*?\r\n]/

describe("weekly vendor scan", () => {
  test("report files have names upload-artifact accepts", async () => {
    const workflow = Bun.YAML.parse(
      await Bun.file(join(root, ".github/workflows/scheduled-scan.yml")).text(),
    ) as Workflow
    const step = Object.values(workflow.jobs)
      .flatMap((job) => job.steps)
      .find((s) => s.name === "Scan vendor images")
    if (!step?.run) throw new Error("no vendor scan step")
    // Stub scanner prints the report
    const dir = await mkdtemp(join(tmpdir(), "sb-scan-"))
    dirs.push(dir)
    await mkdir(join(dir, "infra"))
    await cp(join(root, "infra/compose.yaml"), join(dir, "infra/compose.yaml"))
    const stub = join(dir, "infra/osv-scan.sh")
    await writeFile(stub, '#!/usr/bin/env bash\nbasename "$OSV_REPORT"\n')
    await chmod(stub, 0o755)
    const run = Bun.spawnSync(["bash", "-c", step.run], {
      cwd: dir,
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin", RUNNER_TEMP: dir },
    })
    expect(run.exitCode).toBe(0)
    const names = run.stdout.toString().trim().split("\n")
    expect(names).toHaveLength(6)
    for (const name of names) {
      expect(name).toMatch(/^osv-vendor-[a-z0-9.-]+\.json$/)
      expect(name).not.toMatch(REFUSED)
    }
    expect(new Set(names).size).toBe(names.length)
  })
})
