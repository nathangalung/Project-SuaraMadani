import type { MemberRole } from "../../../db/schema/auth.ts"
import { withTenant } from "../../../db/tenant.server.ts"
import type { VerifyMethod } from "../../../shared/moderation.ts"
import type { ReportStatus } from "../../../shared/status.ts"
import { publishIssue, purgeIssuePages } from "../issues/publish.server.ts"
import {
  MergeRefused,
  type MergeTarget,
  mergeIntoIssue,
} from "./merge.server.ts"
import { reviewReport } from "./verify.server.ts"

export type VerifyIssueInput = {
  reportId: string
  from: ReportStatus
  method: VerifyMethod
  target: MergeTarget
  actorId: string
}

type Refusal = "changed" | "not_allowed" | "no_contact_consent" | "not_found"

export type VerifyIssueResult =
  | { ok: true; code: string }
  | { ok: false; reason: Refusal }

class VerifyRefused extends Error {
  readonly reason: Refusal

  constructor(reason: Refusal) {
    super(`verify refused: ${reason}`)
    this.reason = reason
  }
}

/** Verify, merge, publish, one transaction. */
export async function verifyIntoIssue(
  tenant: { id: string; host: string; campusCode: string },
  role: MemberRole,
  input: VerifyIssueInput,
): Promise<VerifyIssueResult> {
  try {
    const issue = await withTenant(
      tenant.id,
      async (tx) => {
        // Merge email says enough
        const reviewed = await reviewReport(
          tx,
          tenant.id,
          {
            reportId: input.reportId,
            from: input.from,
            action: "verify",
            method: input.method,
            actorId: input.actorId,
          },
          { notify: false },
        )
        if (!reviewed.ok) throw new VerifyRefused(reviewed.reason)
        const merged = await mergeIntoIssue(tx, tenant.id, {
          reportIds: [input.reportId],
          target: input.target,
          actorId: input.actorId,
          campusCode: tenant.campusCode,
          now: new Date(),
        })
        if (input.target.kind === "existing") return merged
        // Only follower is the reporter
        const published = await publishIssue(tx, tenant.id, {
          issueId: merged.id,
          actorId: input.actorId,
          notify: false,
        })
        if (!published.ok) throw new VerifyRefused("changed")
        return { ...published, published: true }
      },
      { role },
    )
    if (issue.published) await purgeIssuePages(tenant.host, issue)
    return { ok: true, code: issue.code }
  } catch (error) {
    if (error instanceof VerifyRefused || error instanceof MergeRefused) {
      return { ok: false, reason: error.reason }
    }
    throw error
  }
}
