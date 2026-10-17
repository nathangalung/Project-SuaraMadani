import { and, asc, eq } from "drizzle-orm"
import { issueReports } from "../../../db/schema/issues.ts"
import { evidence } from "../../../db/schema/reports.ts"
import type { Tx } from "../../../db/tenant.server.ts"
import { fileResponse } from "../../../server/file-response.server.ts"
import {
  defaultFilesDir,
  PUBLIC_MEDIA_NAME,
  publicMediaPath,
} from "../../../server/files.server.ts"
import { type MediaView, mediaView } from "../../../server/media-url.server.ts"
import type { PublicMedia } from "../../../shared/evidence.ts"
import type { EvidenceKind } from "../../../shared/report-fields.ts"

export type PublicEvidence = {
  kind: EvidenceKind
  // Shown as "disensor admin"
  redacted: boolean
  media: PublicMedia[]
}

/** Approved copies only, item 14. */
export async function readPublicEvidence(
  tx: Tx,
  issueId: string,
): Promise<PublicEvidence[]> {
  const rows = await tx
    .select({
      kind: evidence.kind,
      decision: evidence.decision,
      media: evidence.publicMedia,
    })
    .from(evidence)
    .innerJoin(
      issueReports,
      and(
        eq(issueReports.orgId, evidence.orgId),
        eq(issueReports.reportId, evidence.reportId),
      ),
    )
    .where(
      and(eq(issueReports.issueId, issueId), eq(evidence.status, "published")),
    )
    .orderBy(
      asc(issueReports.createdAt),
      asc(evidence.reportId),
      asc(evidence.position),
    )
  return rows.flatMap((row) =>
    row.media && row.media.length > 0
      ? [
          {
            kind: row.kind,
            redacted: row.decision === "redact",
            media: row.media,
          },
        ]
      : [],
  )
}

export type EvidenceView = Omit<PublicEvidence, "media"> & {
  media: MediaView[]
}

/** Unservable copies are skipped. */
export function evidenceViews(
  items: PublicEvidence[],
  host: string,
): EvidenceView[] {
  return items.flatMap((item) => {
    const media = item.media.flatMap((one) => {
      const view = mediaView(one, host)
      return view ? [view] : []
    })
    return media.length > 0 ? [{ ...item, media }] : []
  })
}

/** Dev stand-in for Caddy rules. */
export async function publicMediaResponse(
  request: Request,
  host: string,
  name: string,
): Promise<Response | null> {
  if (!PUBLIC_MEDIA_NAME.test(name)) return null
  const file = Bun.file(publicMediaPath(defaultFilesDir(), host, name))
  if (!(await file.exists())) return null
  return fileResponse(request, file, {
    "Content-Type": name.endsWith(".mp4") ? "video/mp4" : "image/webp",
    // Content-hash name, never changes
    "Cache-Control": "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "sandbox; default-src 'none'",
  })
}
