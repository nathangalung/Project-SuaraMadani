import { mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

// Child processes for media decoders

export class ToolTimeout extends Error {}
// Killed elsewhere, e.g. OOM
export class ToolKilled extends Error {}

export type ToolResult = { exitCode: number; stdout: string; stderr: string }

const MAX_OUTPUT = 65_536

async function readCapped(
  stream: ReadableStream<Uint8Array> | undefined,
): Promise<string> {
  if (!stream) return ""
  const decoder = new TextDecoder()
  let text = ""
  for await (const chunk of stream) {
    if (text.length < MAX_OUTPUT)
      text += decoder.decode(chunk, { stream: true })
  }
  return text.slice(0, MAX_OUTPUT)
}

/** Killed at timeout or abort. */
export async function runTool(
  cmd: string[],
  options: { timeoutMs: number; signal?: AbortSignal; cwd?: string },
): Promise<ToolResult> {
  options.signal?.throwIfAborted()
  const child = Bun.spawn(cmd, {
    cwd: options.cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    killSignal: "SIGKILL",
    signal: options.signal,
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", LC_ALL: "C" },
  })
  // Own timer tells causes apart
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    child.kill("SIGKILL")
  }, options.timeoutMs)
  const [stdout, stderr, exitCode] = await Promise.all([
    readCapped(child.stdout),
    readCapped(child.stderr),
    child.exited,
  ]).finally(() => clearTimeout(timer))
  options.signal?.throwIfAborted()
  if (timedOut) {
    throw new ToolTimeout(`${cmd[0]} killed after ${options.timeoutMs} ms`)
  }
  if (child.signalCode === "SIGKILL") {
    throw new ToolKilled(`${cmd[0]} killed, likely out of memory`)
  }
  return { exitCode, stdout, stderr }
}

const SCRATCH_PREFIX = "sb-media-"

/** Private temp dir, always removed. */
export async function withScratch<T>(
  work: (dir: string) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), SCRATCH_PREFIX))
  try {
    return await work(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** Boot only: one process. */
export async function sweepScratch(dir = tmpdir()): Promise<number> {
  const names = (await readdir(dir)).filter((name) =>
    name.startsWith(SCRATCH_PREFIX),
  )
  for (const name of names) {
    await rm(join(dir, name), { recursive: true, force: true })
  }
  return names.length
}
