import { afterAll, describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const LIB = join(import.meta.dir, "lib.sh")
const dirs: string[] = []

/** app_services with this app.env. */
async function services(env: string): Promise<string[]> {
  const dir = await mkdtemp(join(tmpdir(), "sb-lib-"))
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

/** check_backup_passes exit code. */
function passCheck(dir: string): number {
  return Bun.spawnSync(
    ["bash", "-c", `source "${LIB}" && check_backup_passes`],
    { env: { PATH: process.env.PATH ?? "/usr/bin:/bin", RUN_DIR: dir } },
  ).exitCode
}

describe("check_backup_passes", () => {
  test("refuses short backup passphrases", async () => {
    // ASVS V11.4.4: pgBackRest KDF unstretched
    const dir = await mkdtemp(join(tmpdir(), "sb-lib-"))
    dirs.push(dir)
    const long = "a".repeat(64)
    const write = (cipher: string, restic: string) =>
      writeFile(
        join(dir, "app.env"),
        `PGBACKREST_REPO1_CIPHER_PASS=${cipher}\nRESTIC_PASSWORD=${restic}\n`,
      )
    await write(long, long)
    expect(passCheck(dir)).toBe(0)
    await write("kucing123", long)
    expect(passCheck(dir)).toBe(1)
    await write(long, "")
    expect(passCheck(dir)).toBe(1)
  })
})

/** check_tls_endpoints exit code. */
async function endpointCheck(env: string): Promise<number> {
  const dir = await mkdtemp(join(tmpdir(), "sb-lib-"))
  dirs.push(dir)
  await writeFile(join(dir, "app.env"), env)
  return Bun.spawnSync(
    ["bash", "-c", `source "${LIB}" && check_tls_endpoints`],
    { env: { PATH: process.env.PATH ?? "/usr/bin:/bin", RUN_DIR: dir } },
  ).exitCode
}

describe("check_tls_endpoints", () => {
  // ASVS V12.3.1: signed requests encrypted
  const media = "MEDIA_R2_ENDPOINT=https://a.r2.cloudflarestorage.com\n"
  const restic = "RESTIC_REPOSITORY=s3:https://a.r2.cloudflarestorage.com/b\n"

  test("https endpoints pass", async () => {
    expect(await endpointCheck(media + restic)).toBe(0)
  })

  test("a plaintext or bare endpoint fails", async () => {
    expect(
      await endpointCheck(
        `MEDIA_R2_ENDPOINT=http://a.r2.cloudflarestorage.com\n${restic}`,
      ),
    ).toBe(1)
    expect(
      await endpointCheck(
        `${media}RESTIC_REPOSITORY=s3:http://a.r2.cloudflarestorage.com/b\n`,
      ),
    ).toBe(1)
    expect(await endpointCheck(`${media}RESTIC_REPOSITORY=\n`)).toBe(1)
  })
})

const A = `sha256:${"a".repeat(64)}`
const B = `sha256:${"b".repeat(64)}`
const C = `sha256:${"c".repeat(64)}`
const SHA1 = "1".repeat(40)
const SHA2 = "2".repeat(40)

/** deployed_ref output and exit code. */
async function deployedRef(
  history: string,
  args: string,
): Promise<[number, string]> {
  const dir = await mkdtemp(join(tmpdir(), "sb-lib-"))
  dirs.push(dir)
  await writeFile(
    join(dir, "app.env"),
    "APP_IMAGE=ghcr.io/o/sadar-bersuara\nPOSTGRES_IMAGE=ghcr.io/o/sadar-bersuara-postgres\n",
  )
  await writeFile(join(dir, "history"), history)
  const run = Bun.spawnSync(
    ["bash", "-c", `source "${LIB}" && deployed_ref ${args}`],
    {
      env: {
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        RUN_DIR: dir,
        DEPLOYED_HISTORY: join(dir, "history"),
      },
    },
  )
  return [run.exitCode, run.stdout.toString().trim()]
}

describe("deployed_ref", () => {
  // SC-04: pull by digest only
  const history = [
    `${SHA1} 2026-10-20T00:00:00Z 0033_log_ship 17 deploy ${A} ${C}`,
    `${SHA2} 2026-10-21T00:00:00Z 0034_replies_decided 17 deploy ${B} ${C}`,
    "",
  ].join("\n")

  test("the running release by default", async () => {
    expect(await deployedRef(history, "app")).toEqual([
      0,
      `ghcr.io/o/sadar-bersuara@${B}`,
    ])
    expect(await deployedRef(history, "postgres")).toEqual([
      0,
      `ghcr.io/o/sadar-bersuara-postgres@${C}`,
    ])
  })

  test("an earlier SHA for rollback", async () => {
    expect(await deployedRef(history, `app ${SHA1}`)).toEqual([
      0,
      `ghcr.io/o/sadar-bersuara@${A}`,
    ])
  })

  test("an unknown SHA or a line without digests fails", async () => {
    expect((await deployedRef(history, `app ${"3".repeat(40)}`))[0]).toBe(1)
    const old = `${SHA1} 2026-10-20T00:00:00Z 0033_log_ship 17 deploy\n`
    expect((await deployedRef(old, "app"))[0]).toBe(1)
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

  test("no service keeps raw sockets", async () => {
    // V12.3.3: no ARP spoofing hops
    const compose = Bun.YAML.parse(
      await Bun.file(join(import.meta.dir, "compose.yaml")).text(),
    ) as { services: Record<string, { cap_drop?: string[] }> }
    const raw = Object.entries(compose.services)
      .filter(
        ([, service]) =>
          !service.cap_drop?.includes("ALL") &&
          !service.cap_drop?.includes("NET_RAW"),
      )
      .map(([name]) => name)
    expect(raw).toEqual([])
  })

  test("every service caps processes and file handles", async () => {
    // API4: bounded forks and fds
    const compose = Bun.YAML.parse(
      await Bun.file(join(import.meta.dir, "compose.yaml")).text(),
    ) as {
      services: Record<
        string,
        { pids_limit?: number; ulimits?: { nofile?: { hard?: number } } }
      >
    }
    const unbounded = Object.entries(compose.services)
      .filter(
        ([, service]) =>
          !(Number(service.pids_limit) > 0) ||
          !(Number(service.ulimits?.nofile?.hard) > 0),
      )
      .map(([name]) => name)
    expect(unbounded).toEqual([])
  })
})

/** Docker argv from lib.sh. */
function dockerArgs(call: string, env: Record<string, string> = {}): string[] {
  const run = Bun.spawnSync(
    [
      "bash",
      "-c",
      `source "${LIB}" && docker() { printf '%s\\n' "$@"; } && ${call}`,
    ],
    {
      env: {
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        RUN_DIR: "/run/sb-test",
        APP_REF: "app@sha256:1",
        POSTGRES_REF: "pg@sha256:2",
        ...env,
      },
    },
  )
  expect(run.exitCode).toBe(0)
  return run.stdout.toString().trim().split("\n")
}

describe("compose files", () => {
  const base = join(import.meta.dir, "compose.yaml")

  test("production runs compose.yaml alone", () => {
    expect(dockerArgs("compose ps")).toEqual([
      "compose",
      "-f",
      base,
      "--env-file",
      "/run/sb-test/app.env",
      "ps",
    ])
  })

  test("COMPOSE_OVERRIDE layers one file on top", () => {
    expect(
      dockerArgs("compose ps", { COMPOSE_OVERRIDE: "/w/override.yaml" }),
    ).toEqual([
      "compose",
      "-f",
      base,
      "-f",
      "/w/override.yaml",
      "--env-file",
      "/run/sb-test/app.env",
      "ps",
    ])
  })
})

describe("smoke_run", () => {
  const mount = `${join(import.meta.dir, "smoke.ts")}:/app/smoke.ts:ro`

  test("production smoke runs on the default network", () => {
    expect(dockerArgs("smoke_run app@sha256:1 edge a.test b.test")).toEqual([
      "run",
      "--rm",
      "-v",
      mount,
      "app@sha256:1",
      "bun",
      "smoke.ts",
      "edge",
      "a.test",
      "b.test",
    ])
  })

  test("SMOKE_DOCKER_ARGS reach docker run", () => {
    expect(
      dockerArgs("smoke_run app@sha256:1 a.test", {
        SMOKE_DOCKER_ARGS: "--network cdn -e NODE_EXTRA_CA_CERTS=/ca.pem",
      }),
    ).toEqual([
      "run",
      "--rm",
      "--network",
      "cdn",
      "-e",
      "NODE_EXTRA_CA_CERTS=/ca.pem",
      "-v",
      mount,
      "app@sha256:1",
      "bun",
      "smoke.ts",
      "a.test",
    ])
  })
})

/** umami_default_active, faked compose. */
function umamiDefault(status: string): number {
  return Bun.spawnSync(
    [
      "bash",
      "-c",
      `source "${LIB}" && compose() { printf '%s' "${status}"; } && umami_default_active`,
    ],
    { env: { PATH: process.env.PATH ?? "/usr/bin:/bin" } },
  ).exitCode
}

describe("umami_default_active", () => {
  // OWASP A07: vendor default login
  test("true only while admin/umami signs in", () => {
    expect(umamiDefault("200")).toBe(0)
    expect(umamiDefault("401")).toBe(1)
    expect(umamiDefault("000")).toBe(1)
  })
})
