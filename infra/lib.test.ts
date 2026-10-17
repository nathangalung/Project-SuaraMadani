import { afterAll, describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const LIB = join(import.meta.dir, "lib.sh")
const dirs: string[] = []

/** app_services with this app.env. */
async function services(env: string): Promise<string[]> {
  const dir = await mkdtemp(join(tmpdir(), "sm-lib-"))
  dirs.push(dir)
  await writeFile(join(dir, "app.env"), env)
  const run = Bun.spawnSync(["bash", "-c", `source "${LIB}" && app_services`], {
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", RUN_DIR: dir },
  })
  expect(run.exitCode).toBe(0)
  return run.stdout.toString().trim().split("\n")
}

afterAll(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true })
})

describe("app_services", () => {
  test("WhatsApp runs unless the lever is pulled", async () => {
    expect(await services("APEX_HOST=contoh.id\n")).toEqual([
      "web",
      "worker",
      "worker-media",
      "worker-whatsapp",
    ])
  })

  test("WHATSAPP_ENABLED=false leaves it out", async () => {
    expect(await services("WHATSAPP_ENABLED=false\n")).toEqual([
      "web",
      "worker",
      "worker-media",
    ])
  })
})

describe("compose", () => {
  test("worker-whatsapp starts only by name", async () => {
    const compose = Bun.YAML.parse(
      await Bun.file(join(import.meta.dir, "compose.yaml")).text(),
    ) as { services: Record<string, { profiles?: string[] }> }
    expect(compose.services["worker-whatsapp"]?.profiles).toEqual(["whatsapp"])
    expect(compose.services.web?.profiles).toBeUndefined()
  })
})
