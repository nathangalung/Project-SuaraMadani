import { FileQuestion } from "lucide-react"
import { useState } from "react"
import { Link } from "react-router"
import { Badge, type BadgeTone } from "~/components/ui/badge"
import { ButtonLink } from "~/components/ui/button"
import { Card } from "~/components/ui/card"
import { Note } from "~/components/ui/note"
import { m } from "~/paraglide/messages.js"
import { formatDate } from "../../../shared/format.ts"
import { isRejectReason, standardAnchor } from "../../../shared/moderation.ts"
import type { ReportStatus } from "../../../shared/status.ts"
import { Timeline, type TimelineEntry } from "../issues/timeline"
import { decisionReasonText } from "../moderation/reason-labels"
import { PendingUploads } from "./pending-uploads"
import { REPORT_STATUS_TEXT } from "./public-labels"
import { ReportLabel } from "./report-label"
import type { TrackedReport } from "./tracking.server"

// Still waiting for a file
const NOT_RECEIVED = new Set(["awaiting_upload", "missing"])

function filesText(statuses: readonly string[]): string {
  if (statuses.length === 0) return m.track_no_files()
  const received = statuses.filter((s) => !NOT_RECEIVED.has(s)).length
  return m.track_files({ received, total: statuses.length })
}

// Port-spec 6.7, never red
const STATUS_TONE: Record<ReportStatus, BadgeTone> = {
  submitted: "neutral",
  in_review: "soft",
  verified: "success",
  unverifiable: "neutral",
  rejected: "neutral",
  merged: "ink",
  forwarded: "brand",
}

// Only dates we store
function historyOf(report: TrackedReport): TimelineEntry[] {
  const entries: TimelineEntry[] = [
    { at: report.createdAt, title: m.track_event_sent(), tone: "muted" },
  ]
  if (report.verifiedAt) {
    entries.push({
      at: report.verifiedAt,
      title: m.track_event_verified(),
      tone: "success",
    })
  }
  if (report.merged) {
    entries.push({
      at: report.merged.at,
      title: m.track_event_merged(),
      tone: "ink",
    })
  }
  return entries
}

const LINK =
  "font-semibold text-accent underline underline-offset-4 hover:no-underline"

// PLAN §5.10: reason reaches reporter
function Outcome({ report }: { report: TrackedReport }) {
  const { decision, forwardedTo } = report
  if (decision) {
    return (
      <Note className="mt-4 bg-surface-raised">
        <p className="font-semibold">
          {m.track_reason({ reason: decisionReasonText(decision.reason) })}
        </p>
        <p className="mt-1">{m.track_reason_text()}</p>
        <p className="whitespace-pre-line">{decision.text}</p>
        {isRejectReason(decision.reason) ? (
          <Link
            to={`/pedoman#${standardAnchor(decision.reason)}`}
            className={`mt-2 inline-block ${LINK}`}
          >
            {m.track_standard_link()}
          </Link>
        ) : null}
      </Note>
    )
  }
  if (forwardedTo) {
    return (
      <Note className="mt-4 bg-surface-raised">
        <p>{m.track_forwarded_to({ campus: forwardedTo.campus })}</p>
        <a href={forwardedTo.url} className={`mt-2 inline-block ${LINK}`}>
          {m.track_forwarded_link({ campus: forwardedTo.campus })}
        </a>
      </Note>
    )
  }
  return null
}

function ReportCard({
  report,
  tenant,
  canUpload,
}: {
  report: TrackedReport
  tenant: string
  canUpload: boolean
}) {
  const merged = report.merged
  const issueCode = merged?.code
  const titleId = `report-${report.code}`
  // Sent rows keep their message
  const [pending] = useState({
    items: report.pendingUploads,
    until: report.uploadUntil,
  })
  return (
    <Card variant="pastel" className="rounded-xl">
      <article aria-labelledby={titleId}>
        <div className="px-6 pt-6 sm:px-8 sm:pt-8">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <ReportLabel
              code={report.code}
              tenant={tenant}
              rows={[
                {
                  label: m.report_label_sent(),
                  value: formatDate(report.createdAt),
                },
                {
                  label: m.track_files_label(),
                  value: filesText(report.evidence),
                },
              ]}
            />
            <Badge tone={STATUS_TONE[report.status]}>
              {REPORT_STATUS_TEXT[report.status]()}
            </Badge>
          </div>
          <h2 id={titleId} className="mt-5 font-semibold text-2xl leading-snug">
            {report.title}
          </h2>
          <Outcome report={report} />
          {pending.items.length > 0 && pending.until ? (
            <PendingUploads
              items={pending.items}
              until={pending.until}
              canUpload={canUpload}
              titleId={`${titleId}-upload`}
              reportTitleId={titleId}
            />
          ) : null}
        </div>
        <div
          className={`mt-6 grid gap-8 border-ink/15 border-t p-6 sm:p-8 ${merged ? "md:grid-cols-[1fr_16rem]" : ""}`}
        >
          <section aria-labelledby={`${titleId}-history ${titleId}`}>
            <h3 id={`${titleId}-history`} className="font-bold text-xl">
              {m.track_history_title()}
            </h3>
            <Timeline
              entries={historyOf(report)}
              on="pastel"
              className="mt-5 ml-1.5"
            />
          </section>
          {issueCode ? (
            <div className="self-start bg-ink p-5 text-surface-raised">
              <p className="text-sm">{m.track_merged_note()}</p>
              <p className="mt-1 font-bold text-2xl tabular-nums">
                {issueCode}
              </p>
              <Link
                to={`/isu/${issueCode}`}
                className="mt-3 inline-block font-semibold text-sm underline underline-offset-2 hover:no-underline"
              >
                {m.track_merged_link()}
              </Link>
            </div>
          ) : merged ? (
            <Note className="self-start bg-surface-raised">
              {m.track_merged_pending()}
            </Note>
          ) : null}
        </div>
      </article>
    </Card>
  )
}

export function TrackingResult({
  campus,
  tenant,
  reports,
  capped = false,
  canUpload,
}: {
  campus: string
  tenant: string
  reports: TrackedReport[]
  // Query stopped at its limit
  capped?: boolean
  // Session owner, not a link
  canUpload: boolean
}) {
  if (reports.length === 0) {
    return (
      <Card className="mx-auto flex max-w-2xl flex-col items-center rounded-xl px-6 py-14 text-center">
        <FileQuestion aria-hidden="true" className="size-10 text-brand" />
        <p className="mt-4 font-semibold text-lg">
          {m.track_empty({ campus })}
        </p>
        <ButtonLink to="/lapor" variant="secondary" className="mt-6">
          {m.report_start()}
        </ButtonLink>
      </Card>
    )
  }
  return (
    <>
      <ul className="flex flex-col gap-8">
        {reports.map((report) => (
          <li key={report.code}>
            <ReportCard report={report} tenant={tenant} canUpload={canUpload} />
          </li>
        ))}
      </ul>
      {capped ? (
        <Note className="mt-8">
          {m.track_capped({ count: reports.length })}
        </Note>
      ) : null}
      <p className="mt-12 border-ink/15 border-t pt-6 text-center text-ink-soft">
        {m.track_closing()}{" "}
        <Link
          to="/lapor"
          className="font-semibold text-accent underline underline-offset-4 hover:no-underline"
        >
          {m.report_start()}
        </Link>
      </p>
    </>
  )
}
