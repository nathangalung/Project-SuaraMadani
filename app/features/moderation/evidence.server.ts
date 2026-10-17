import { and, eq, inArray, isNotNull, sql } from "drizzle-orm"
import { sendJobs } from "../../../db/jobs.server.ts"
import { auditLog } from "../../../db/schema/audit.ts"
import type { MemberRole } from "../../../db/schema/auth.ts"
import { issueReports, issues } from "../../../db/schema/issues.ts"
import { evidence, reports } from "../../../db/schema/reports.ts"
import { type Tx, withTenant } from "../../../db/tenant.server.ts"
import { fileResponse } from "../../../server/file-response.server.ts"
import {
  defaultFilesDir,
  derivedPath,
  originalPath,
} from "../../../server/files.server.ts"
import type { EvidenceDecision } from "../../../shared/evidence.ts"
import {
  type DecisionError,
  parseDecision,
} from "../../../shared/evidence-decision.ts"
import { originalAvailable, originalFileName } from "./original.ts"

const PREVIEWABLE = ["ready", "published"] as const
const PAGE = /^(\d{1,2})\.webp$/

/** Ready copy, path from row. */
export async function readPreview(
  orgId: string,
  role: MemberRole,
  evidenceId: string,
  filesDir = defaultFilesDir(),
  name = "0.webp",
): Promise<Blob | null> {
  const row = await withTenant(
    orgId,
    async (tx) => {
      const [found] = await tx
        .select({
          id: evidence.id,
          orgId: evidence.orgId,
          kind: evidence.kind,
          pages: evidence.previewPages,
        })
        .from(evidence)
        .where(
          and(
            eq(evidence.id, evidenceId),
            inArray(evidence.status, PREVIEWABLE),
          ),
        )
        .limit(1)
      return found
    },
    { role },
  )
  if (!row) return null
  const page = PAGE.exec(name)
  const known = page
    ? Number(page[1]) < row.pages
    : name === "video.mp4" && row.kind === "video"
  if (!known) return null
  const file = Bun.file(derivedPath(filesDir, row.orgId, row.id, name))
  return (await file.exists()) ? file : null
}

/** Unmodified original, audited. */
export async function readOriginal(
  orgId: string,
  input: {
    role: MemberRole
    actorId: string
    evidenceId: string
    filesDir?: string
  },
): Promise<{ file: Blob; name: string } | null> {
  const row = await withTenant(
    orgId,
    async (tx) => {
      const [found] = await tx
        .select({
          id: evidence.id,
          status: evidence.status,
          kind: evidence.kind,
          failureReason: evidence.failureReason,
          scanned: sql<boolean>`${evidence.scannedAt} IS NOT NULL`,
          declaredName: evidence.declaredName,
          detectedType: evidence.detectedType,
          position: evidence.position,
        })
        .from(evidence)
        .where(eq(evidence.id, input.evidenceId))
        .limit(1)
      // ClamAV gate, architecture Uploads
      if (!found || !originalAvailable(found)) return null
      await tx.insert(auditLog).values({
        orgId,
        actorId: input.actorId,
        action: "evidence.download_original",
        entityType: "evidence",
        entityId: found.id,
      })
      return found
    },
    { role: input.role },
  )
  if (!row) return null
  const file = Bun.file(
    originalPath(input.filesDir ?? defaultFilesDir(), orgId, row.id),
  )
  return (await file.exists()) ? { file, name: originalFileName(row) } : null
}

/** Approved files of public issues. */
async function queueApproved(
  tx: Tx,
  orgId: string,
  where: { issueId: string } | { evidenceId: string },
): Promise<number> {
  const rows = await tx
    .select({ id: evidence.id })
    .from(evidence)
    .innerJoin(
      issueReports,
      and(
        eq(issueReports.orgId, evidence.orgId),
        eq(issueReports.reportId, evidence.reportId),
      ),
    )
    .innerJoin(
      issues,
      and(
        eq(issues.orgId, issueReports.orgId),
        eq(issues.id, issueReports.issueId),
      ),
    )
    .where(
      and(
        isNotNull(issues.publishedAt),
        eq(evidence.status, "ready"),
        inArray(evidence.decision, ["redact", "no_redaction"]),
        "issueId" in where
          ? eq(issues.id, where.issueId)
          : eq(evidence.id, where.evidenceId),
      ),
    )
  await sendJobs(
    tx,
    "evidence-publish",
    rows.map((row) => ({ orgId, evidenceId: row.id })),
  )
  return rows.length
}

/** Publish and merge call this. */
export function queueIssueEvidence(
  tx: Tx,
  orgId: string,
  issueId: string,
): Promise<number> {
  return queueApproved(tx, orgId, { issueId })
}

export type DecideInput = {
  evidenceId: string
  actorId: string
  // decided_at the form saw
  seen: string | null
  input: unknown
}

export type DecideResult =
  | { ok: true; queued: boolean }
  | {
      ok: false
      reason: "not_found" | "not_ready" | "changed" | DecisionError
    }

/** editEvidence and approveEvidence, PLAN §5.10. */
export function decideEvidence(
  orgId: string,
  input: DecideInput,
): Promise<DecideResult> {
  return withTenant(
    orgId,
    async (tx): Promise<DecideResult> => {
      const [row] = await tx
        .select({
          kind: evidence.kind,
          status: evidence.status,
          pages: evidence.previewPages,
          decidedAt: evidence.decidedAt,
        })
        .from(evidence)
        .where(eq(evidence.id, input.evidenceId))
        .for("update")
      if (!row) return { ok: false, reason: "not_found" }
      // Published copies change via takedown
      if (row.status !== "ready") return { ok: false, reason: "not_ready" }
      if ((row.decidedAt?.toISOString() ?? null) !== input.seen) {
        return { ok: false, reason: "changed" }
      }
      const parsed = parseDecision(
        { kind: row.kind, pages: row.pages },
        input.input,
      )
      if (!parsed.ok) return { ok: false, reason: parsed.error }
      const { decision, boxes, pages } = parsed.value
      await tx
        .update(evidence)
        .set({
          decision,
          redactionBoxes: boxes,
          publishPages: pages,
          decidedBy: input.actorId,
          decidedAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(eq(evidence.id, input.evidenceId))
      await tx.insert(auditLog).values({
        orgId,
        actorId: input.actorId,
        action: "evidence.decide",
        entityType: "evidence",
        entityId: input.evidenceId,
        changedColumns: ["decision", "redaction_boxes", "publish_pages"],
        reasonCode: decision satisfies EvidenceDecision,
      })
      const queued =
        decision === "withhold"
          ? 0
          : await queueApproved(tx, orgId, { evidenceId: input.evidenceId })
      return { ok: true, queued: queued > 0 }
    },
    { role: "admin" },
  )
}

/** Editor view, tenant-scoped. */
export function getEvidenceEditor(
  orgId: string,
  role: MemberRole,
  evidenceId: string,
) {
  return withTenant(
    orgId,
    async (tx) => {
      const [row] = await tx
        .select({
          id: evidence.id,
          reportId: evidence.reportId,
          kind: evidence.kind,
          status: evidence.status,
          position: evidence.position,
          previewPages: evidence.previewPages,
          sourcePages: evidence.sourcePages,
          durationMs: evidence.durationMs,
          failureReason: evidence.failureReason,
          decision: evidence.decision,
          boxes: evidence.redactionBoxes,
          pages: evidence.publishPages,
          decidedAt: evidence.decidedAt,
          publicMedia: evidence.publicMedia,
          reportCode: reports.publicCode,
        })
        .from(evidence)
        .innerJoin(
          reports,
          and(
            eq(reports.orgId, evidence.orgId),
            eq(reports.id, evidence.reportId),
          ),
        )
        .where(eq(evidence.id, evidenceId))
        .limit(1)
      if (!row) return null
      const [issue] = await tx
        .select({ code: issues.publicCode, publishedAt: issues.publishedAt })
        .from(issueReports)
        .innerJoin(
          issues,
          and(
            eq(issues.orgId, issueReports.orgId),
            eq(issues.id, issueReports.issueId),
          ),
        )
        .where(eq(issueReports.reportId, row.reportId))
        .limit(1)
      const { reportId: _, decidedAt, ...rest } = row
      return {
        ...rest,
        // Optimistic lock token
        seen: decidedAt?.toISOString() ?? null,
        issue: issue
          ? { code: issue.code, published: issue.publishedAt !== null }
          : null,
      }
    },
    { role },
  )
}

/** Inline preview, sandboxed. */
export function previewResponse(
  request: Request,
  file: Blob,
  name: string,
): Response {
  return fileResponse(request, file, {
    "Content-Type": name === "video.mp4" ? "video/mp4" : "image/webp",
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "sandbox; default-src 'none'",
  })
}
