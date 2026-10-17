import { ExternalLink, Send } from "lucide-react"
import { m } from "~/paraglide/messages.js"
import { formatIsoDate } from "../../../shared/format.ts"
import { CHANNEL_TEXT } from "./labels"
import type { IssueReferral, IssueResponse } from "./record.server"

export type ReferralWait = { days: number; overdue: boolean } | null

// PLAN §6.1 item 3
function referralText(referral: IssueReferral): string {
  const values = {
    agency: referral.agency,
    channel: CHANNEL_TEXT[referral.channel](),
    date: formatIsoDate(referral.sentOn),
  }
  const line =
    referral.kind === "referral"
      ? m.issue_referral_line(values)
      : m.issue_escalation_line(values)
  return referral.ticket
    ? `${line} · ${m.issue_ticket({ ticket: referral.ticket })}`
    : line
}

/** Latest referral and escalation lines. */
export function ReferralLines({
  referral,
  escalation,
  wait,
}: {
  referral: IssueReferral | null
  escalation: IssueReferral | null
  wait: ReferralWait
}) {
  if (!referral && !escalation) return null
  return (
    <div className="flex flex-col gap-1.5 font-ui text-[0.95rem] text-ink">
      {[referral, escalation].map((item) =>
        item ? (
          <p key={item.id} className="flex items-start gap-1.5">
            <Send
              aria-hidden="true"
              className="mt-1 size-4 shrink-0 text-brand"
            />
            <span>{referralText(item)}</span>
          </p>
        ) : null,
      )}
      {referral?.deadlineOn ? (
        <p className="pl-[1.375rem]">
          {m.issue_deadline({ date: formatIsoDate(referral.deadlineOn) })}
          {wait ? ` · ${m.issue_wait_days({ days: wait.days })}` : null}
          {wait?.overdue ? (
            <strong className="font-semibold">
              {" · "}
              {m.issue_wait_overdue()}
            </strong>
          ) : null}
        </p>
      ) : null}
    </div>
  )
}

function sourceHost(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/** Full text, never HTML. */
export function ResponseList({ responses }: { responses: IssueResponse[] }) {
  return (
    <ol className="mt-4 flex flex-col">
      {responses.map((response) => (
        <li
          key={response.id}
          className="border-line-subtle border-b py-5 first:pt-2 last:border-b-0"
        >
          <h3 className="font-bold text-lg">{response.agency}</h3>
          <p className="mt-0.5 font-ui text-ink-muted text-sm">
            <time dateTime={response.respondedOn}>
              {formatIsoDate(response.respondedOn)}
            </time>
          </p>
          <p className="mt-3 max-w-3xl whitespace-pre-line text-ink leading-relaxed">
            {response.body}
          </p>
          <p className="mt-3 font-ui text-sm">
            {m.issue_response_source()}{" "}
            <a
              href={response.sourceUrl}
              rel="nofollow ugc noopener noreferrer"
              className="inline-flex items-center gap-1 font-semibold text-accent underline underline-offset-4 hover:no-underline"
            >
              {sourceHost(response.sourceUrl)}
              <ExternalLink aria-hidden="true" className="size-3.5" />
            </a>
          </p>
        </li>
      ))}
    </ol>
  )
}
