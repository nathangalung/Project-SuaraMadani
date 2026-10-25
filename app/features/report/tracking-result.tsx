import { FileQuestion } from "lucide-react"
import { useState } from "react"
import { Link } from "react-router"
import { Badge, type BadgeTone } from "~/components/ui/badge"
import { ButtonLink } from "~/components/ui/button"
import { Card } from "~/components/ui/card"
import { Note } from "~/components/ui/note"
import { Pagination } from "~/components/ui/pagination"
import { m } from "~/paraglide/messages.js"
import { formatDate } from "../../../shared/format.ts"
import type { ReportStatus } from "../../../shared/status.ts"
import { Timeline, type TimelineEntry } from "../issues/timeline"
import { PendingUploads } from "./pending-uploads"
import { REPORT_STATUS_TEXT } from "./public-labels"
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

// PLAN §5.10: reason reaches reporter
function Outcome({ report }: { report: TrackedReport }) {
  const { decision } = report
  if (decision) {
    return (
      <Note className="mt-4 bg-surface-raised">
        <p className="font-semibold">{m.track_reason_text()}</p>
        <p className="mt-1 whitespace-pre-line">{decision.text}</p>
      </Note>
    )
  }
  return null
}

// Compact rounded card, like IssueCard
function ReportCard({
  report,
  canUpload,
}: {
  report: TrackedReport
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
    <article
      aria-labelledby={titleId}
      className="rounded-2xl border border-line-subtle bg-surface-raised p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold text-ink-soft tabular-nums">
          {report.code}
        </span>
        <Badge tone={STATUS_TONE[report.status]}>
          {REPORT_STATUS_TEXT[report.status]()}
        </Badge>
      </div>
      <h2 id={titleId} className="mt-3 font-bold text-xl leading-snug">
        {report.title}
      </h2>
      <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-2 text-sm">
        <div>
          <dt className="text-ink-muted">{m.report_label_sent()}</dt>
          <dd className="font-semibold">{formatDate(report.createdAt)}</dd>
        </div>
        <div>
          <dt className="text-ink-muted">{m.track_files_label()}</dt>
          <dd className="font-semibold">{filesText(report.evidence)}</dd>
        </div>
      </dl>
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
      <div
        className={`mt-5 grid gap-6 border-line-subtle border-t pt-5 ${merged ? "md:grid-cols-[1fr_16rem]" : ""}`}
      >
        <section aria-labelledby={`${titleId}-history ${titleId}`}>
          <h3 id={`${titleId}-history`} className="font-bold">
            {m.track_history_title()}
          </h3>
          <Timeline entries={historyOf(report)} className="mt-4 ml-1.5" />
        </section>
        {issueCode ? (
          <div className="self-start rounded-xl bg-surface p-4">
            <p className="text-ink-soft text-sm">{m.track_merged_note()}</p>
            <p className="mt-1 font-bold text-lg tabular-nums">{issueCode}</p>
            <Link
              to={`/isu/${issueCode}`}
              className="mt-2 inline-block font-semibold text-accent text-sm underline underline-offset-4 hover:no-underline"
            >
              {m.track_merged_link()}
            </Link>
          </div>
        ) : merged ? (
          <Note className="self-start">{m.track_merged_pending()}</Note>
        ) : null}
      </div>
    </article>
  )
}

export function TrackingResult({
  campus,
  reports,
  page = 1,
  pageCount = 1,
  pageHref,
  canUpload,
}: {
  campus: string
  reports: TrackedReport[]
  page?: number
  pageCount?: number
  pageHref?: (page: number) => string
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
      <ul className="flex flex-col gap-5">
        {reports.map((report) => (
          <li key={report.code}>
            <ReportCard report={report} canUpload={canUpload} />
          </li>
        ))}
      </ul>
      {pageHref ? (
        <Pagination
          page={page}
          pageCount={pageCount}
          href={pageHref}
          className="mt-10"
        />
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
