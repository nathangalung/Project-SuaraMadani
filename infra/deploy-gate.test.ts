import { describe, expect, test } from "bun:test"
import { join } from "node:path"

const GATE = join(import.meta.dir, "deploy-gate.sh")
const SHA = "a".repeat(40)
const APP = `sha256:${"1".repeat(64)}`
const PG = `sha256:${"2".repeat(64)}`

/** Exit code, root never exists. */
function gate(command: string): number {
  return Bun.spawnSync(["bash", GATE], {
    env: {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      SSH_ORIGINAL_COMMAND: command,
      DEPLOY_ROOT: "/nonexistent/sadar-bersuara",
    },
    stderr: "pipe",
  }).exitCode
}

describe("deploy-gate", () => {
  // SC-04: digests or nothing
  test("[AC-DEPLOY-01] Given the deploy key's forced command, when a deploy lacks an image digest or carries extra words, then it is refused before git", () => {
    expect(gate(`deploy ${SHA}`)).toBe(2)
    expect(gate(`deploy ${SHA} ${APP}`)).toBe(2)
    expect(gate(`deploy ${SHA} ${APP} latest`)).toBe(2)
    expect(gate(`deploy ${SHA} ${APP} ${PG} extra`)).toBe(2)
  })

  test("[AC-DEPLOY-01] Given the deploy key's forced command, when a rollback names more than a SHA, then it is refused before git", () => {
    expect(gate(`rollback ${SHA} ${APP}`)).toBe(2)
    expect(gate("rollback main")).toBe(2)
  })

  test("well-formed commands reach git", () => {
    // git fails, root missing
    expect(gate(`deploy ${SHA} ${APP} ${PG}`)).not.toBe(2)
    expect(gate(`rollback ${SHA}`)).not.toBe(2)
  })
})
