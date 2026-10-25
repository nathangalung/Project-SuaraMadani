import { Badge, type BadgeTone } from "~/components/ui/badge"
import { cn } from "~/components/ui/cn"
import { m } from "~/paraglide/messages.js"
import { type CategoryId, isCategoryId } from "../../../shared/categories.ts"
import {
  type AdvocacyStatus,
  type GovernmentStatus,
  type IssueState,
  type PublicStage,
  publicStage,
  type VerificationLabel,
} from "../../../shared/status.ts"
import { CATEGORY_SHORT_TEXT } from "../report/category-labels"
import {
  ADVOCACY_TEXT,
  GOVERNMENT_TEXT,
  STAGE_TEXT,
  VERIFICATION_TEXT,
} from "./labels"

// Port-spec 6.1, one map
const VERIFICATION_TONE: Record<VerificationLabel, BadgeTone> = {
  verified: "soft",
  unverified: "neutral",
}

const ADVOCACY_TONE: Record<AdvocacyStatus, BadgeTone> = {
  monitoring: "neutral",
  referred: "brand",
  escalated: "ink",
}

// Off-path states never red
const GOVERNMENT_TONE: Record<GovernmentStatus, BadgeTone> = {
  awaiting_response: "neutral",
  responded: "ink",
  in_progress: "brand",
  claimed_resolved: "soft",
  confirmed_resolved: "success",
  reopened: "neutral",
  not_competent: "neutral",
  not_followed_up: "neutral",
  closed: "neutral",
}

// Decorative, label carries meaning
const CATEGORY_MARK: Record<CategoryId, string> = {
  program: "bg-brand",
  bencana: "bg-danger",
  bansos: "bg-pop-strong",
}

export function CategoryBadge({ categoryId }: { categoryId: string }) {
  if (!isCategoryId(categoryId)) return null
  return (
    <Badge tone="subtle">
      <span
        aria-hidden="true"
        className={`size-2.5 shrink-0 rounded-full ${CATEGORY_MARK[categoryId]}`}
      />
      {CATEGORY_SHORT_TEXT[categoryId]()}
    </Badge>
  )
}

export function VerificationBadge({ label }: { label: VerificationLabel }) {
  return (
    <Badge tone={VERIFICATION_TONE[label]}>{VERIFICATION_TEXT[label]()}</Badge>
  )
}

export function GovernmentBadge({ status }: { status: GovernmentStatus }) {
  return (
    <Badge tone={GOVERNMENT_TONE[status]}>
      {m.issue_government_label()}: {GOVERNMENT_TEXT[status]()}
    </Badge>
  )
}

type Props = {
  verificationLabel: VerificationLabel
  advocacyStatus: AdvocacyStatus
  govStatus: GovernmentStatus
}

// Axis named in text
export function IssueStatus({
  verificationLabel,
  advocacyStatus,
  govStatus,
}: Props) {
  return (
    <ul className="flex flex-wrap gap-2">
      <li>
        <VerificationBadge label={verificationLabel} />
      </li>
      <li>
        <Badge tone={ADVOCACY_TONE[advocacyStatus]}>
          {m.issue_advocacy_label()}: {ADVOCACY_TEXT[advocacyStatus]()}
        </Badge>
      </li>
      <li>
        <GovernmentBadge status={govStatus} />
      </li>
    </ul>
  )
}

export function CategoryMark({ categoryId }: { categoryId: string }) {
  if (!isCategoryId(categoryId)) return null
  return (
    <span className="font-bold text-ink">
      {CATEGORY_SHORT_TEXT[categoryId]()}
    </span>
  )
}

// Colour per stage, checked pairs
const STAGE_PILL: Record<PublicStage, string> = {
  verified: "bg-chip text-ink",
  referred: "bg-accent-soft text-ink",
  responded: "bg-highlight text-ink",
  in_progress: "bg-brand text-on-accent",
  done: "bg-success text-on-accent",
}

/** Public stage as a pill. */
export function StageMark({
  advocacy,
  government,
  className,
}: IssueState & { className?: string }) {
  const stage = publicStage({ advocacy, government })
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-3 py-1 font-semibold font-ui text-sm",
        STAGE_PILL[stage],
        className,
      )}
    >
      {STAGE_TEXT[stage]()}
    </span>
  )
}
