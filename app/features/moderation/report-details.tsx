import { Play } from "lucide-react"
import type { ReactNode } from "react"
import { ButtonLink } from "~/components/ui/button"
import { m } from "~/paraglide/messages.js"
import type { EvidenceFailure } from "../../../shared/evidence.ts"
import {
  formatDate,
  formatDateTime,
  formatDuration,
} from "../../../shared/format.ts"
import type { EvidenceKind } from "../../../shared/report-fields.ts"
import { CATEGORY_SHORT_TEXT } from "../report/category-labels"
import {
  CONTACTABLE_TEXT,
  COUNT_TEXT,
  GROUP_TEXT,
  ONGOING_TEXT,
  OTHER_CONSENT_TEXT,
  RELATION_TEXT,
  URGENCY_TEXT,
} from "../report/labels"
import { labelOf, SUBCATEGORY_TEXT } from "../report/public-labels"
import { originalAvailable } from "./original.ts"
import type { ReviewReport } from "./queue.server"

type EvidenceStatus = ReviewReport["evidence"][number]["status"]

export const EVIDENCE_STATUS_TEXT: Record<EvidenceStatus, () => string> = {
  awaiting_upload: m.evidence_status_awaiting_upload,
  received: m.evidence_status_received,
  ready: m.evidence_status_ready,
  missing: m.evidence_status_missing,
  rejected_limits: m.evidence_status_rejected_limits,
  needs_manual_review: m.evidence_status_needs_manual_review,
  rejected_malware: m.evidence_status_rejected_malware,
  published: m.evidence_status_published,
}

const EVIDENCE_KIND_TEXT: Record<EvidenceKind, () => string> = {
  image: m.evidence_kind_image,
  pdf: m.evidence_kind_pdf,
  video: m.evidence_kind_video,
}

export const FAILURE_TEXT: Record<EvidenceFailure, () => string> = {
  sha256_mismatch: m.manage_evidence_failure_sha256_mismatch,
  unsupported_type: m.manage_evidence_failure_unsupported_type,
  decode_failed: m.manage_evidence_failure_decode_failed,
  attempts_exhausted: m.manage_evidence_failure_attempts_exhausted,
  multi_image: m.manage_evidence_failure_multi_image,
  malware: m.manage_evidence_failure_malware,
  video_too_long: m.manage_evidence_failure_video_too_long,
  video_resolution: m.manage_evidence_failure_video_resolution,
  no_video_stream: m.manage_evidence_failure_no_video_stream,
  timeout: m.manage_evidence_failure_timeout,
  image_too_large: m.manage_evidence_failure_image_too_large,
}

const LINK = "font-semibold text-accent underline underline-offset-4"

function Row({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 border-line-subtle border-b py-3 md:grid-cols-[14rem_1fr]">
      <dt className="font-semibold">{term}</dt>
      <dd className="min-w-0 whitespace-pre-line">{children}</dd>
    </div>
  )
}

export function ReportDetails({ report }: { report: ReviewReport }) {
  const place = [
    report.villageName,
    report.districtName,
    report.regencyName,
    report.provinceName,
  ]
    .filter(Boolean)
    .join(", ")
  const groups = report.affectedGroups
    .map((group) => labelOf(GROUP_TEXT, group) ?? group)
    .join(", ")
  // Same format as step 7
  const category = labelOf(CATEGORY_SHORT_TEXT, report.categoryId)
  const subcategory = labelOf(SUBCATEGORY_TEXT, report.subcategoryId)
  return (
    <dl>
      <Row term={m.manage_received_at()}>
        {formatDateTime(report.createdAt)}
      </Row>
      <Row term={m.review_relation()}>
        {labelOf(RELATION_TEXT, report.relation)}
      </Row>
      {report.otherConsent ? (
        <Row term={m.review_other_consent()}>
          {labelOf(OTHER_CONSENT_TEXT, report.otherConsent)}
        </Row>
      ) : null}
      <Row term={m.review_location()}>{place}</Row>
      {report.point ? (
        <Row term={m.review_point()}>
          {`${report.point.lat.toFixed(5)}, ${report.point.lng.toFixed(5)}`}
        </Row>
      ) : null}
      <Row term={m.review_title()}>{report.title}</Row>
      <Row term={m.review_story()}>{report.story}</Row>
      <Row term={m.review_category()}>
        {category && subcategory ? `${category}: ${subcategory}` : category}
      </Row>
      <Row term={m.review_occurred()}>
        {formatDate(new Date(`${report.occurredOn}T00:00:00+07:00`))}
      </Row>
      <Row term={m.review_agency()}>
        {report.agency ?? m.review_not_filled()}
      </Row>
      <Row term={m.review_urgency()}>
        {labelOf(URGENCY_TEXT, report.urgency)}
      </Row>
      <Row term={m.review_groups()}>{groups}</Row>
      <Row term={m.review_count()}>
        {labelOf(COUNT_TEXT, report.affectedCount)}
      </Row>
      <Row term={m.review_ongoing()}>
        {labelOf(ONGOING_TEXT, report.ongoing)}
      </Row>
      <Row term={m.review_contact()}>
        {labelOf(CONTACTABLE_TEXT, report.contactable ? "yes" : "no")}
      </Row>
      <Row term={m.review_forward_consent()}>
        {labelOf(CONTACTABLE_TEXT, report.forwardConsent ? "yes" : "no")}
      </Row>
    </dl>
  )
}

const PREVIEWABLE = new Set<EvidenceStatus>(["ready", "published"])

type ReviewFile = ReviewReport["evidence"][number]

function kindText(file: ReviewFile): string {
  if (file.kind === "pdf" && file.sourcePages) {
    return m.manage_evidence_pdf_pages({
      pages: file.previewPages,
      total: file.sourcePages,
    })
  }
  if (file.kind === "video" && file.durationMs !== null) {
    return m.evidence_video_meta({ duration: formatDuration(file.durationMs) })
  }
  return EVIDENCE_KIND_TEXT[file.kind]()
}

function stateText(file: ReviewFile): string {
  if (file.status === "published") return m.manage_evidence_state_published()
  if (file.status !== "ready") return EVIDENCE_STATUS_TEXT[file.status]()
  switch (file.decision) {
    case "redact":
      return m.manage_evidence_state_redact({ count: file.boxes })
    case "no_redaction":
      return m.manage_evidence_state_no_redaction()
    case "withhold":
      return m.manage_evidence_state_withhold()
    default:
      return m.manage_evidence_state_none()
  }
}

// Processed copies only
export function EvidenceList({ report }: { report: ReviewReport }) {
  if (report.evidence.length === 0) return <p>{m.manage_evidence_none()}</p>
  return (
    <ul className="grid gap-6 md:grid-cols-2">
      {report.evidence.map((file) => {
        const position = file.position + 1
        const base = `/kelola/bukti/${file.id}`
        return (
          <li
            key={file.id}
            id={`bukti-${file.id}`}
            className="flex flex-col border border-line-subtle bg-surface-raised"
          >
            {PREVIEWABLE.has(file.status) ? (
              <div className="relative bg-surface">
                <img
                  src={`${base}/0.webp`}
                  alt={m.manage_evidence_alt({ position, code: report.code })}
                  loading="lazy"
                  className="aspect-[4/3] w-full object-contain"
                />
                {file.kind === "video" ? (
                  <span className="absolute inset-0 grid place-items-center">
                    <span className="grid size-12 place-items-center bg-ink/80 text-surface-raised">
                      <Play aria-hidden="true" className="size-6" />
                    </span>
                  </span>
                ) : null}
              </div>
            ) : (
              <p className="m-4 border-2 border-line-subtle border-dashed p-4">
                {m.manage_evidence_waiting({
                  position,
                  status: EVIDENCE_STATUS_TEXT[file.status](),
                })}
              </p>
            )}
            <div className="flex flex-1 flex-col gap-1.5 p-4">
              <p className="font-semibold">
                {m.manage_evidence_item({ position })} · {kindText(file)}
              </p>
              <p className="break-all text-ink-muted text-sm">
                {file.declaredName}
              </p>
              <p className="text-sm">{stateText(file)}</p>
              {file.failureReason ? (
                <p className="text-sm">
                  {m.manage_evidence_failure({
                    reason: FAILURE_TEXT[file.failureReason](),
                  })}
                </p>
              ) : null}
              <div className="mt-auto flex flex-wrap items-center gap-x-5 gap-y-2 pt-3">
                {PREVIEWABLE.has(file.status) ? (
                  <ButtonLink
                    to={`${base}/sunting`}
                    variant="secondary"
                    size="sm"
                  >
                    {file.status === "ready"
                      ? m.manage_evidence_open_editor()
                      : m.manage_evidence_open_decision()}
                  </ButtonLink>
                ) : null}
                {!originalAvailable(file) ? null : (
                  <a href={`${base}/asli`} download className={LINK}>
                    {m.manage_evidence_download()}
                  </a>
                )}
              </div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
