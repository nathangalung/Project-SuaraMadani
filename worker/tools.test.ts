import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readdir, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  runTool,
  sweepScratch,
  ToolKilled,
  ToolTimeout,
  withScratch,
} from "./tools.ts"

describe("runTool", () => {
  test("returns exit code and output", async () => {
    const ok = await runTool(["sh", "-c", "echo hi; echo oops >&2; exit 3"], {
      timeoutMs: 5_000,
    })
    expect(ok).toEqual({ exitCode: 3, stdout: "hi\n", stderr: "oops\n" })
  })

  test("kills a child past its timeout", async () => {
    const started = performance.now()
    await expect(
      runTool(["sleep", "5"], { timeoutMs: 200 }),
    ).rejects.toBeInstanceOf(ToolTimeout)
    expect(performance.now() - started).toBeLessThan(2_000)
  })

  test("another SIGKILL is not a timeout", async () => {
    // Like the cgroup OOM killer
    const run = runTool(["sh", "-c", "kill -9 $$"], { timeoutMs: 5_000 })
    await expect(run).rejects.toBeInstanceOf(ToolKilled)
    await expect(run).rejects.not.toBeInstanceOf(ToolTimeout)
  })

  test("aborts with the job signal", async () => {
    const controller = new AbortController()
    setTimeout(() => controller.abort(new Error("stop")), 100)
    await expect(
      runTool(["sleep", "5"], { timeoutMs: 5_000, signal: controller.signal }),
    ).rejects.toThrow("stop")
  })

  test("caps captured output", async () => {
    const out = await runTool(["sh", "-c", "head -c 200000 /dev/zero"], {
      timeoutMs: 5_000,
    })
    expect(out.stdout.length).toBeLessThanOrEqual(65_536)
  })
})

describe("withScratch", () => {
  test("removes its directory after use and on error", async () => {
    let kept = ""
    await withScratch(async (dir) => {
      kept = dir
      await Bun.write(join(dir, "a"), "x")
    })
    await expect(stat(kept)).rejects.toThrow()
    await expect(
      withScratch(async (dir) => {
        kept = dir
        throw new Error("boom")
      }),
    ).rejects.toThrow("boom")
    await expect(stat(kept)).rejects.toThrow()
  })
})

describe("sweepScratch", () => {
  test("boot removes dirs a killed job left", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sweep-"))
    await mkdir(join(dir, "sb-media-abc123"))
    await Bun.write(join(dir, "sb-media-abc123", "in.heic"), "x")
    await mkdir(join(dir, "sb-media-def456"))
    await mkdir(join(dir, "keep-me"))
    expect(await sweepScratch(dir)).toBe(2)
    expect(await readdir(dir)).toEqual(["keep-me"])
    await rm(dir, { recursive: true, force: true })
  })
})
