import { cn } from "~/components/ui/cn"
import { m } from "~/paraglide/messages.js"
import { formatDate, formatIsoDate } from "../../../shared/format.ts"
import type { IssueEventAction } from "../../../shared/moderation.ts"
import {
  type AdvocacyStatus,
  type GovernmentStatus,
  INITIAL_ISSUE_STATE,
} from "../../../shared/status.ts"
import { ADVOCACY_TEXT, CHANNEL_TEXT, GOVERNMENT_TEXT } from "./labels"
import type { IssueEvent, IssueRecord } from "./record.server"

export type TimelineEntry = {
  // Stable key across renders
  id?: string
  at: Date
  title: string
  // Same-page anchor for the title
  href?: string
  // Who acted, after the date
  actor?: string
  body?: string
  // PLAN §5.4: status in text
  status?: string
  // Dot colour, PLAN status meaning
  tone?: "muted" | "brand" | "ink" | "success"
}

// Dot ring matches the backdrop
const RING = { page: "ring-surface", pastel: "ring-brand-soft" } as const

const DOT = {
  muted: "bg-ink-muted",
  brand: "bg-brand",
  ink: "bg-ink",
  success: "bg-success",
} as const

/** Newest first, mockup Timeline. */
export function Timeline({
  entries,
  on = "page",
  className,
}: {
  entries: TimelineEntry[]
  on?: keyof typeof RING
  className?: string
}) {
  const sorted = [...entries].sort((a, b) => b.at.getTime() - a.at.getTime())
  return (
    <ol
      className={cn(
        "relative space-y-6 border-ink/15 border-l-[3px] pl-6",
        className,
      )}
    >
      {sorted.map((entry, i) => (
        <li
          key={entry.id ?? `${entry.at.toISOString()}-${entry.title}`}
          className="relative"
        >
          <span
            aria-hidden="true"
            className={cn(
              "absolute rounded-full ring-4",
              RING[on],
              DOT[entry.tone ?? "muted"],
              i === 0
                ? "top-0.5 -left-[calc(1.5rem+10px)] size-4"
                : "top-1 -left-[calc(1.5rem+9px)] size-3.5",
            )}
          />
          <p>
            <time
              dateTime={entry.at.toISOString()}
              className="text-ink-muted text-sm"
            >
              {formatDate(entry.at)}
            </time>
            {entry.actor ? (
              <span className="text-ink-muted text-sm"> · {entry.actor}</span>
            ) : null}
          </p>
          <p className="mt-0.5 font-semibold text-ink">
            {entry.href ? (
              <a
                href={entry.href}
                className="decoration-2 decoration-brand underline underline-offset-4"
              >
                {entry.title}
              </a>
            ) : (
              entry.title
            )}
          </p>
          {entry.body ? (
            <p className="mt-0.5 whitespace-pre-line text-ink-soft leading-relaxed">
              {entry.body}
            </p>
          ) : null}
          {entry.status ? (
            <p className="mt-0.5 font-ui text-ink text-sm">{entry.status}</p>
          ) : null}
        </li>
      ))}
    </ol>
  )
}

// Detail rows cascade with events
const HEADLINE: Record<IssueEventAction, () => string> = {
  refer: m.advocacy_referred,
  escalate: m.advocacy_escalated,
  record_response: m.gov_responded,
  mark_in_progress: m.timeline_mark_in_progress,
  claim_resolved: m.timeline_claim_resolved,
  confirm_resolved: m.timeline_confirm_resolved,
  reopen: m.timeline_reopen,
  mark_not_competent: m.timeline_mark_not_competent,
  mark_not_followed_up: m.timeline_mark_not_followed_up,
  close: m.timeline_close,
  merge: m.timeline_merge,
}

const TONE: Partial<Record<IssueEventAction, TimelineEntry["tone"]>> = {
  refer: "brand",
  escalate: "brand",
  record_response: "ink",
  confirm_resolved: "success",
}

function eventEntry(
  event: IssueEvent,
  record: IssueRecord,
  before: { advocacy: AdvocacyStatus; government: GovernmentStatus },
): TimelineEntry {
  const referral = record.referrals.find((r) => r.id === event.referralId)
  const response = record.responses.find((r) => r.id === event.responseId)
  let title: string
  let body: string | undefined
  if ((event.action === "refer" || event.action === "escalate") && referral) {
    const values = {
      agency: referral.agency,
      channel: CHANNEL_TEXT[referral.channel](),
    }
    title =
      event.action === "refer"
        ? m.timeline_refer(values)
        : m.timeline_escalate(values)
    const parts = [
      referral.ticket ? m.timeline_ticket({ ticket: referral.ticket }) : null,
      referral.deadlineOn
        ? m.timeline_deadline({ date: formatIsoDate(referral.deadlineOn) })
        : null,
    ].filter((part) => part !== null)
    body = parts.length > 0 ? parts.join(" · ") : undefined
  } else if (event.action === "record_response" && response) {
    title = m.timeline_record_response({ agency: response.agency })
  } else {
    title = HEADLINE[event.action]()
  }
  const changed: string[] = []
  if (event.advocacyStatus !== before.advocacy) {
    changed.push(ADVOCACY_TEXT[event.advocacyStatus]())
  }
  if (event.govStatus !== before.government) {
    changed.push(GOVERNMENT_TEXT[event.govStatus]())
  }
  return {
    id: event.id,
    at: event.occurredAt,
    title,
    actor: m.timeline_actor_admin(),
    body: event.note ?? body,
    status:
      changed.length > 0
        ? m.timeline_status({ status: changed.join(" · ") })
        : undefined,
    tone: TONE[event.action] ?? "ink",
  }
}

type MergeRun = { first: IssueEvent; last: IssueEvent; n: number }

/** Published entry plus stored events. */
export function issueHistory(issue: {
  publishedAt: Date
  record: IssueRecord
}): TimelineEntry[] {
  const entries: TimelineEntry[] = [
    {
      id: "published",
      at: issue.publishedAt,
      title: m.issue_history_published(),
      tone: "brand",
    },
  ]
  let state = {
    advocacy: INITIAL_ISSUE_STATE.advocacy,
    government: INITIAL_ISSUE_STATE.government,
  }
  // PLAN §6.1: minor events summarised
  let run = null as MergeRun | null
  const flush = () => {
    if (!run) return
    const { first, last, n } = run
    const from = formatDate(first.occurredAt)
    const to = formatDate(last.occurredAt)
    entries.push(
      n === 1
        ? eventEntry(first, issue.record, state)
        : {
            id: first.id,
            at: last.occurredAt,
            title: m.timeline_merge_many({ n }),
            actor: m.timeline_actor_admin(),
            // Header already shows one day
            body:
              from === to ? undefined : m.timeline_merge_range({ from, to }),
            tone: "ink",
          },
    )
    run = null
  }
  for (const event of issue.record.events) {
    const plain =
      event.action === "merge" &&
      event.note === null &&
      event.advocacyStatus === state.advocacy &&
      event.govStatus === state.government
    if (plain) {
      run = { first: run?.first ?? event, last: event, n: (run?.n ?? 0) + 1 }
      continue
    }
    flush()
    entries.push(eventEntry(event, issue.record, state))
    state = { advocacy: event.advocacyStatus, government: event.govStatus }
  }
  flush()
  return entries
}
