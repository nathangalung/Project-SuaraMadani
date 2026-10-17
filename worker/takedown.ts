import { rm } from "node:fs/promises"
import { dirname } from "node:path"
import { and, eq, sql } from "drizzle-orm"
import type { Db } from "../db/client.server.ts"
import type { JobPayloads } from "../db/jobs.server.ts"
import { takedowns } from "../db/schema/moderation.ts"
import { organizations } from "../db/schema/organizations.ts"
import { withTenant } from "../db/tenant.server.ts"
import {
  defaultFilesDir,
  derivedPath,
  originalPath,
  publicMediaPath,
} from "../server/files.server.ts"
import { writeLog } from "../server/log.ts"
import { type PurgeClient, purgeClientFromEnv } from "../server/purge.server.ts"
import { mediaStoreFromEnv } from "./media-store.ts"

export type TakedownDeps = {
  filesDir: string
  purge: PurgeClient
  // R2 media host, purged too
  mediaHost: string | null
  deleteVideo: (host: string, name: string) => Promise<void>
  // Production: unpurged edge fails
  requirePurge: boolean
  db?: Db
}

export type TakedownOutcome = "done" | "skipped"

type Step = "files" | "object_store" | "purge"

class StepError extends Error {
  constructor(
    readonly step: Step,
    cause: unknown,
  ) {
    super(`takedown ${step} failed`, { cause })
  }
}

async function step<T>(name: Step, run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    throw new StepError(name, error)
  }
}

/** Host of MEDIA_PUBLIC_ORIGIN, https only. */
function mediaHostFromEnv(value: string | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === "https:" ? url.hostname : null
  } catch {
    return null
  }
}

function defaultTakedownDeps(): TakedownDeps {
  const filesDir = defaultFilesDir()
  return {
    filesDir,
    purge: purgeClientFromEnv(),
    mediaHost: mediaHostFromEnv(process.env.MEDIA_PUBLIC_ORIGIN),
    // Built on first R2 file
    deleteVideo: (host, name) =>
      mediaStoreFromEnv(filesDir).deleteVideo(host, name),
    requirePurge: process.env.NODE_ENV === "production",
  }
}

/** Names a published row serves. */
async function liveNames(
  orgId: string,
  names: readonly string[],
  options: { db?: Db },
): Promise<Set<string>> {
  if (names.length === 0) return new Set()
  const rows = await withTenant(
    orgId,
    (tx) =>
      tx.execute<{ name: string }>(sql`
        SELECT DISTINCT n.name
        FROM evidence e,
          jsonb_array_elements(e.public_media) m,
          LATERAL (VALUES (m->>'file'), (m->>'poster')) n(name)
        WHERE e.status = 'published'
          AND n.name IN (${sql.join(
            names.map((name) => sql`${name}`),
            sql`, `,
          )})`),
    options,
  )
  return new Set(rows.rows.map((row) => row.name))
}

/** Files, then hostname purge. */
export function createTakedownHandler(
  deps: TakedownDeps = defaultTakedownDeps(),
) {
  const options = { db: deps.db }
  return async ({
    orgId,
    takedownId,
  }: JobPayloads["takedown"]): Promise<TakedownOutcome> => {
    const found = await withTenant(
      orgId,
      async (tx) => {
        const [row] = await tx
          .select({
            status: takedowns.purgeStatus,
            files: takedowns.publicFiles,
            evidenceIds: takedowns.evidenceIds,
            host: organizations.host,
          })
          .from(takedowns)
          .innerJoin(organizations, eq(organizations.id, takedowns.orgId))
          .where(eq(takedowns.id, takedownId))
        return row
      },
      options,
    )
    // Empty read means wrong org
    if (!found) throw new Error("takedown not found under tenant")
    if (found.status === "done") return "skipped"
    const settle = (values: {
      purgeStatus: "done" | "retrying"
      lastError: Step | null
    }) =>
      withTenant(
        orgId,
        (tx) =>
          tx
            .update(takedowns)
            .set({
              ...values,
              attempts: sql`${takedowns.attempts} + 1`,
              doneAt: values.purgeStatus === "done" ? sql`now()` : null,
            })
            .where(
              and(eq(takedowns.id, takedownId), eq(takedowns.orgId, orgId)),
            ),
        options,
      )
    try {
      // Republished since, keep serving
      const live = await step("files", () =>
        liveNames(
          orgId,
          found.files.map((file) => file.file),
          options,
        ),
      )
      await step("files", async () => {
        for (const file of found.files) {
          if (file.store !== "local" || live.has(file.file)) continue
          await rm(publicMediaPath(deps.filesDir, found.host, file.file), {
            force: true,
          })
        }
        for (const id of found.evidenceIds) {
          await rm(originalPath(deps.filesDir, orgId, id), { force: true })
          await rm(dirname(derivedPath(deps.filesDir, orgId, id)), {
            recursive: true,
            force: true,
          })
        }
      })
      await step("object_store", async () => {
        for (const file of found.files) {
          if (file.store === "r2" && !live.has(file.file)) {
            await deps.deleteVideo(found.host, file.file)
          }
        }
      })
      await step("purge", async () => {
        const { skipped } = await deps.purge.purgeHosts(
          deps.mediaHost ? [found.host, deps.mediaHost] : [found.host],
        )
        if (!skipped) return
        if (deps.requirePurge) throw new Error("purge not configured")
        writeLog({ msg: "takedown purge skipped", queue: "takedown" })
      })
    } catch (error) {
      await settle({
        purgeStatus: "retrying",
        lastError: error instanceof StepError ? error.step : "files",
      })
      throw error
    }
    await settle({ purgeStatus: "done", lastError: null })
    return "done"
  }
}
