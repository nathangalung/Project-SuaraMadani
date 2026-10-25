import { eq } from "drizzle-orm"
import { demands } from "../../../db/schema/demands.ts"
import { issues } from "../../../db/schema/issues.ts"
import { withTenant } from "../../../db/tenant.server.ts"
import type { PurgeDeps } from "../../../server/purge.server.ts"
import { isLegalReason, type LegalReason } from "../../../shared/complaints.ts"
import { purgeDemandPages } from "../demands/purge.server.ts"
import { hideDemand, withdrawIssue } from "./complaints.server.ts"

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

export type LegalDemandInput = {
  code: string
  // Demand version the form saw
  version: number
  reason: LegalReason
  actorId: string
}

/** CMP-18: tuntutan under legal order. */
export async function legalTakedownDemand(
  tenant: { id: string; host: string },
  input: LegalDemandInput,
  deps: PurgeDeps = {},
): Promise<LegalTakedownResult> {
  if (!isLegalReason(input.reason)) return { ok: false, reason: "not_allowed" }
  const result = await withTenant(
    tenant.id,
    async (tx) => {
      const [demand] = await tx
        .select({
          id: demands.id,
          code: demands.publicCode,
          state: demands.state,
          version: demands.version,
        })
        .from(demands)
        .where(eq(demands.publicCode, input.code))
        .for("update")
      if (!demand) return { ok: false, reason: "not_found" } as const
      if (demand.version !== input.version) {
        return { ok: false, reason: "changed" } as const
      }
      // Drafts are already private
      if (demand.state === "draft") {
        return { ok: false, reason: "not_allowed" } as const
      }
      const purge = await hideDemand(tx, tenant.id, demand, {
        reason: input.reason,
        actorId: input.actorId,
        complaintId: null,
      })
      return { ok: true, purge } as const
    },
    { role: "admin" },
  )
  if (!result.ok) return result
  // Worker retries the host purge
  await purgeDemandPages(tenant.host, result.purge, deps)
  return { ok: true }
}
