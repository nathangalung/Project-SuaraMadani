import { describe, expect, test } from "bun:test"

const dir = new URL("./", import.meta.url).pathname
const read = (name: string) => Bun.file(`${dir}${name}`).text()

// ASVS V14.2.4, V16.2.4: log rules
describe("log configuration", () => {
  test("postgres logs carry no values", async () => {
    const conf = await read("postgresql.conf")
    for (const line of [
      "log_parameter_max_length = 0",
      "log_parameter_max_length_on_error = 0",
      "log_error_verbosity = terse",
    ]) {
      expect(conf.split("\n")).toContain(line)
    }
  })

  test("pg_stat_statements splits I/O time", async () => {
    // PERF-20: blk_read_time stays 0 otherwise
    const conf = await read("postgresql.conf")
    expect(conf.split("\n")).toContain("track_io_timing = on")
  })

  test("dev postgres logs the same way", async () => {
    const compose = Bun.YAML.parse(await read("compose.dev.yaml")) as {
      services: { postgres: { command: string[] } }
    }
    const settings = compose.services.postgres.command.filter(
      (_, i, all) => all[i - 1] === "-c",
    )
    expect(settings).toEqual(
      expect.arrayContaining([
        "log_parameter_max_length=0",
        "log_parameter_max_length_on_error=0",
        "log_error_verbosity=terse",
      ]),
    )
  })

  test("caddy rolls daily and keeps cf_ray", async () => {
    const caddy = await read("Caddyfile")
    // Idle hosts still drop IPs
    expect(caddy).toMatch(/^\s*roll_interval 24h$/m)
    expect(caddy).toMatch(/^\s*roll_keep 31$/m)
    expect(caddy).toMatch(/^\s*roll_keep_for 720h$/m)
    expect(caddy).toMatch(
      /^\s*log_append cf_ray \{http\.request\.header\.Cf-Ray\}$/m,
    )
  })
})
