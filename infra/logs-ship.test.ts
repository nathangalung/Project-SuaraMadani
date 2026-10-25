import { afterAll, describe, expect, test } from "bun:test"
import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const dir = import.meta.dir
const read = (name: string) => Bun.file(join(dir, name)).text()
const dirs: string[] = []

afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true })
})

/** ship_window from lib.sh. */
function window(age: string) {
  const run = Bun.spawnSync(
    [
      "bash",
      "-c",
      `source "${join(dir, "lib.sh")}" && ship_window "$1"`,
      "_",
      age,
    ],
    { env: { PATH: process.env.PATH ?? "/usr/bin:/bin" } },
  )
  return { code: run.exitCode, out: run.stdout.toString() }
}

// ASVS V16.4.3: off-host copy
describe("log shipping", () => {
  test("Caddy's gzipped rolls inside the window ship, oldest first", async () => {
    const logs = await mkdtemp(join(tmpdir(), "sb-caddy-"))
    dirs.push(logs)
    const minutesAgo = async (name: string, text: string, minutes: number) => {
      const path = join(logs, name)
      await writeFile(path, name.endsWith(".gz") ? Bun.gzipSync(text) : text)
      const at = new Date(Date.now() - minutes * 60_000)
      await utimes(path, at, at)
    }
    await minutesAgo("access.log", "current\n", 0)
    await minutesAgo("access-2026-10-21T09-00-00.000-time.log.gz", "old\n", 180)
    await minutesAgo("access-2026-10-21T11-00-00.000-size.log.gz", "a\n", 40)
    await minutesAgo("access-2026-10-21T11-30-00.000-size.log.gz", "b\n", 10)
    await minutesAgo("access-2026-10-21T11-45-00.000-size.log", "c\n", 5)
    const run = Bun.spawnSync(["sh", join(dir, "caddy-logs.sh"), logs, "65"])
    expect(run.exitCode).toBe(0)
    expect(run.stdout.toString()).toBe("a\nb\nc\ncurrent\n")
  })

  test("the window reaches back to the last copy, 30 days at most", () => {
    expect(window("0")).toEqual({ code: 0, out: "65" })
    expect(window("200")).toEqual({ code: 0, out: "205" })
    expect(window("999999")).toEqual({ code: 0, out: "43200" })
    expect(window("x").code).not.toBe(0)
  })

  test("the copy reads the last success and Caddy's rolls", async () => {
    const ship = await read("logs-ship.sh")
    expect(ship).toContain("ship_window")
    expect(ship).toContain("caddy-logs.sh")
    expect(ship).toMatch(/--since "\$\{minutes\}m"/)
    expect(ship).not.toContain("access*.log | head")
  })

  test("a run that waits on a lock leaves no gap", async () => {
    // Stub docker and clock
    const stub = await mkdtemp(join(tmpdir(), "sb-ship-"))
    dirs.push(stub)
    const realDate = Bun.which("date") ?? "/usr/bin/date"
    const start = 1_800_000_000
    await writeFile(join(stub, "clock"), `${start}\n`)
    await writeFile(join(stub, "app.env"), "WHATSAPP_ENABLED=false\n")
    const script = (body: string) => `#!/bin/sh\n${body}\n`
    await writeFile(
      join(stub, "date"),
      script(`exec ${realDate} -u -d "@$(cat "$STUB/clock")" "$@"`),
      { mode: 0o755 },
    )
    await writeFile(
      join(stub, "docker"),
      script(`echo "$*" >>"$STUB/calls"
case "$*" in
  (*"SELECT"*) echo 95 ;;
  (*"restic backup"*)
    cat >/dev/null
    echo $(($(cat "$STUB/clock") + 1500)) >"$STUB/clock" ;;
  (*"exec -T caddy"*) cat >/dev/null ;;
esac`),
      { mode: 0o755 },
    )
    const run = Bun.spawnSync(["bash", join(dir, "logs-ship.sh"), "ship"], {
      env: {
        PATH: `${stub}:${process.env.PATH ?? "/usr/bin:/bin"}`,
        STUB: stub,
        RUN_DIR: stub,
        APP_REF: "app",
        POSTGRES_REF: "postgres",
      },
    })
    expect(run.exitCode).toBe(0)
    const calls = (await Bun.file(join(stub, "calls")).text()).split("\n")
    const call = (part: string) => calls.find((c) => c.includes(part)) ?? ""
    // Last success 95 min ago
    expect(call(" logs --no-color")).toContain("--since 100m")
    // Caddy read 25 min later
    expect(call("exec -T caddy")).toContain("/var/log/caddy 125")
    // Stamped when logs were read
    expect(call("INSERT")).toContain(
      `VALUES ('logs', '${new Date(start * 1000).toISOString().replace(".000", "")}'::timestamptz)`,
    )
  })

  test("restic waits for a lock instead of failing", async () => {
    for (const name of ["logs-ship.sh", "backup-evidence.sh"]) {
      const script = await read(name)
      const calls = script.match(
        /restic\b[^\n]*\b(backup|forget|check)\b[^\n]*/g,
      )
      expect([name, calls?.length ?? 0]).not.toEqual([name, 0])
      for (const call of calls ?? []) expect(call).toContain("--retry-lock")
    }
  })

  test("a deploy ships the outgoing containers' logs first", async () => {
    const deploy = await read("deploy.sh")
    // Deploy never waits long
    const ship = deploy.indexOf(
      'RESTIC_RETRY_LOCK=1m "$INFRA/logs-ship.sh" ship',
    )
    expect(ship).toBeGreaterThan(-1)
    expect(ship).toBeLessThan(deploy.indexOf("\ncompose up -d\n"))
  })
})
