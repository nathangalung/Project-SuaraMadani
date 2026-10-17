import { createHash } from "node:crypto"
import { rm } from "node:fs/promises"
import { and, eq, isNotNull, sql } from "drizzle-orm"
import type { JobPayloads } from "../db/jobs.server.ts"
import { issueReports, issues } from "../db/schema/issues.ts"
import { organizations } from "../db/schema/organizations.ts"
import { evidence } from "../db/schema/reports.ts"
import { withTenant } from "../db/tenant.server.ts"
import { writeAtomic } from "../server/atomic-file.server.ts"
import { derivedPath, publicMediaPath } from "../server/files.server.ts"
import { writeLog } from "../server/log.ts"
import type { PublicMedia } from "../shared/evidence.ts"
import { censorImage } from "./censor.ts"
import type { EvidenceDeps } from "./evidence-common.ts"
import type { MediaStoreClient } from "./media-store.ts"

export type PublishOutcome = "published" | "skipped"

/** After approval, items 14, 19. */
export function createPublishHandler(
  deps: EvidenceDeps & { store: MediaStoreClient },
) {
  const options = { db: deps.db }

  const load = (orgId: string, evidenceId: string) =>
    withTenant(
      orgId,
      async (tx) => {
        const [row] = await tx
          .select({
            status: evidence.status,
            kind: evidence.kind,
            decision: evidence.decision,
            boxes: evidence.redactionBoxes,
            pages: evidence.publishPages,
            reportId: evidence.reportId,
            // Text keeps microseconds
            decidedAt: sql<string | null>`${evidence.decidedAt}::text`,
          })
          .from(evidence)
          .where(eq(evidence.id, evidenceId))
        // Deleted, or wrong org
        if (!row) return undefined
        // Re-checked at write time
        const [issue] = await tx
          .select({ id: issues.id })
          .from(issueReports)
          .innerJoin(
            issues,
            and(
              eq(issues.orgId, issueReports.orgId),
              eq(issues.id, issueReports.issueId),
            ),
          )
          .where(
            and(
              eq(issueReports.reportId, row.reportId),
              isNotNull(issues.publishedAt),
            ),
          )
        const [org] = await tx
          .select({ host: organizations.host })
          .from(organizations)
          .where(eq(organizations.id, orgId))
        return { ...row, issuePublished: Boolean(issue), host: org?.host }
      },
      options,
    )

  // Row id in name
  const nameOf = (evidenceId: string, bytes: Uint8Array, ext: string) =>
    `${createHash("sha256").update(evidenceId).update(bytes).digest("hex")}.${ext}`

  const writeImage = async (
    host: string,
    evidenceId: string,
    bytes: Buffer,
  ) => {
    const name = nameOf(evidenceId, bytes, "webp")
    await writeAtomic(publicMediaPath(deps.filesDir, host, name), bytes)
    return name
  }

  return async function publishEvidence(
    { orgId, evidenceId }: JobPayloads["evidence-publish"],
    signal?: AbortSignal,
  ): Promise<PublishOutcome> {
    const row = await load(orgId, evidenceId)
    if (!row) {
      writeLog({ msg: "evidence row gone", queue: "evidence-publish" })
      return "skipped"
    }
    if (
      row.status !== "ready" ||
      !row.issuePublished ||
      !row.host ||
      (row.decision !== "redact" && row.decision !== "no_redaction")
    ) {
      return "skipped"
    }
    const derived = (name: string) =>
      Bun.file(derivedPath(deps.filesDir, orgId, evidenceId, name))
    const media: PublicMedia[] = []
    if (row.kind === "video") {
      const video = await derived("video.mp4").bytes()
      const file = nameOf(evidenceId, video, "mp4")
      await deps.store.putVideo(row.host, file, video)
      const poster = await censorImage(
        Buffer.from(await derived("0.webp").arrayBuffer()),
        [],
      )
      media.push({
        type: "video",
        file,
        poster: await writeImage(row.host, evidenceId, poster.buffer),
        store: deps.store.kind,
        width: poster.width,
        height: poster.height,
      })
    } else {
      for (const page of row.pages ?? []) {
        signal?.throwIfAborted()
        const out = await censorImage(
          Buffer.from(await derived(`${page}.webp`).arrayBuffer()),
          row.boxes.filter((box) => box.page === page),
        )
        media.push({
          type: "image",
          file: await writeImage(row.host, evidenceId, out.buffer),
          page,
          width: out.width,
          height: out.height,
        })
      }
    }
    const [done] = await withTenant(
      orgId,
      (tx) =>
        tx
          .update(evidence)
          .set({
            status: "published",
            publicMedia: media,
            publishedAt: sql`now()`,
            updatedAt: sql`now()`,
          })
          .where(
            and(
              eq(evidence.id, evidenceId),
              eq(evidence.status, "ready"),
              // Decision changed meanwhile
              sql`${evidence.decidedAt}::text = ${row.decidedAt}`,
              // Hidden meanwhile, stay private
              sql`EXISTS (SELECT 1 FROM issue_reports l
                JOIN issues i ON i.org_id = l.org_id AND i.id = l.issue_id
                WHERE l.org_id = ${orgId} AND l.report_id = ${row.reportId}
                  AND i.published_at IS NOT NULL)`,
            ),
          )
          .returning({ id: evidence.id }),
      options,
    )
    if (done) return "published"
    // Remove copies nobody references
    for (const item of media) {
      const host = row.host
      if (item.type === "video") {
        await deps.store.deleteVideo(host, item.file)
        await rm(publicMediaPath(deps.filesDir, host, item.poster), {
          force: true,
        })
      } else {
        await rm(publicMediaPath(deps.filesDir, host, item.file), {
          force: true,
        })
      }
    }
    return "skipped"
  }
}
