import { createHash } from "node:crypto"
import { readFile, rm } from "node:fs/promises"
import { and, eq, sql } from "drizzle-orm"
import type { Db } from "../db/client.server.ts"
import type { JobPayloads } from "../db/jobs.server.ts"
import { policyBriefs } from "../db/schema/demands.ts"
import { withTenant } from "../db/tenant.server.ts"
import { writeAtomic } from "../server/atomic-file.server.ts"
import { briefPath, cleanBriefPath } from "../server/files.server.ts"
import { type ClamdConfig, clamdFromEnv, scanBytes } from "./clamav.ts"
import { stripPdfMetadata } from "./pdf.ts"

// Staff PDF: scan, then strip

export type BriefOutcome = "clean" | "infected" | "skipped" | "removed"

// Starting Values: one qpdf run
const STRIP_TIMEOUT_MS = 30_000

type Strip = (
  bytes: Uint8Array,
  signal?: AbortSignal,
) => Promise<Uint8Array | null>

export function createBriefScanHandler(deps: {
  filesDir: string
  db?: Db
  clamd?: ClamdConfig
  // Null: qpdf cannot read
  strip?: Strip
}) {
  const clamd = deps.clamd ?? clamdFromEnv()
  const strip: Strip =
    deps.strip ??
    ((bytes, signal) =>
      stripPdfMetadata(bytes, { timeoutMs: STRIP_TIMEOUT_MS, signal }))
  const options = { db: deps.db }
  return async (
    { orgId, briefId }: JobPayloads["evidence-brief"],
    signal?: AbortSignal,
  ): Promise<BriefOutcome> => {
    const [row] = await withTenant(
      orgId,
      (tx) =>
        tx
          .select({ status: policyBriefs.status, sha256: policyBriefs.sha256 })
          .from(policyBriefs)
          .where(eq(policyBriefs.id, briefId)),
      options,
    )
    const publicCopy = cleanBriefPath(deps.filesDir, orgId, briefId)
    // Replaced, withdrawn or deleted
    if (!row) {
      await rm(publicCopy, { force: true })
      return "removed"
    }
    if (row.status !== "pending") return "skipped"
    const bytes = await readFile(briefPath(deps.filesDir, orgId, briefId))
    if (createHash("sha256").update(bytes).digest("hex") !== row.sha256) {
      throw new Error("brief sha256 mismatch")
    }
    const verdict = await scanBytes(bytes, clamd, signal)
    const cleaned = verdict.infected ? null : await strip(bytes, signal)
    // Unreadable is never served
    const status = cleaned ? "clean" : "infected"
    if (cleaned) await writeAtomic(publicCopy, cleaned)
    await withTenant(
      orgId,
      (tx) =>
        tx
          .update(policyBriefs)
          .set({ status, scannedAt: sql`now()` })
          .where(
            and(
              eq(policyBriefs.id, briefId),
              eq(policyBriefs.status, "pending"),
            ),
          ),
      options,
    )
    return status
  }
}
