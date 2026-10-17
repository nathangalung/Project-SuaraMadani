import { eq } from "drizzle-orm"
import { issues } from "../../../db/schema/issues.ts"
import { withTenant } from "../../../db/tenant.server.ts"
import type { LegalReason } from "../../../shared/complaints.ts"
import { withdrawIssue } from "./complaints.server.ts"

export type LegalTakedownInput = {
  issueId: string
  // Issue version the form saw
  version: number
  decision: "hide" | "remove"
  reason: LegalReason
  actorId: string
}

export type LegalTakedownResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "changed" | "not_allowed" }

/** Komdigi order or data owner. */
export function legalTakedown(
  tenant: { id: string },
  input: LegalTakedownInput,
): Promise<LegalTakedownResult> {
  return withTenant(
    tenant.id,
    async (tx): Promise<LegalTakedownResult> => {
      const [issue] = await tx
        .select({
          id: issues.id,
          version: issues.version,
          publishedAt: issues.publishedAt,
          takenDownAt: issues.takenDownAt,
        })
        .from(issues)
        .where(eq(issues.id, input.issueId))
        .for("update")
      if (!issue) return { ok: false, reason: "not_found" }
      if (issue.version !== input.version) {
        return { ok: false, reason: "changed" }
      }
      return withdrawIssue(tx, tenant.id, issue, {
        remove: input.decision === "remove",
        reason: input.reason,
        complaintId: null,
        actorId: input.actorId,
      })
    },
    { role: "admin" },
  )
}
