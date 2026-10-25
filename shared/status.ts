// Pure state machines, PLAN §5.4.

export const REPORT_STATUSES = [
  "submitted",
  // Legacy rows, review step removed
  "in_review",
  "verified",
  "unverifiable",
  "rejected",
  "merged",
  // Legacy rows, campus forwarding removed
  "forwarded",
] as const
export type ReportStatus = (typeof REPORT_STATUSES)[number]

export const REPORT_ACTIONS = [
  "verify",
  "mark_unverifiable",
  "reject",
  "merge",
] as const
export type ReportAction = (typeof REPORT_ACTIONS)[number]

export const ADVOCACY_STATUSES = [
  "monitoring",
  "referred",
  "escalated",
] as const
export type AdvocacyStatus = (typeof ADVOCACY_STATUSES)[number]

export const GOVERNMENT_STATUSES = [
  "awaiting_response",
  "responded",
  "in_progress",
  // Legacy rows, claim step removed
  "claimed_resolved",
  "confirmed_resolved",
  "reopened",
  "not_competent",
  "not_followed_up",
  "closed",
] as const
export type GovernmentStatus = (typeof GOVERNMENT_STATUSES)[number]

export type IssueState = {
  advocacy: AdvocacyStatus
  government: GovernmentStatus
}

// Public path, team 22 Oct
export const PUBLIC_STAGES = [
  "verified",
  "referred",
  "responded",
  "in_progress",
  "done",
] as const
export type PublicStage = (typeof PUBLIC_STAGES)[number]

// Government statuses per stage
export const STAGE_GOVERNMENT: Readonly<
  Record<PublicStage, readonly GovernmentStatus[]>
> = {
  verified: ["awaiting_response", "not_competent", "not_followed_up"],
  referred: ["awaiting_response", "not_competent", "not_followed_up"],
  responded: ["responded"],
  in_progress: ["in_progress", "claimed_resolved", "reopened"],
  done: ["confirmed_resolved", "closed"],
}

/** One public stage, both axes. */
export function publicStage(state: IssueState): PublicStage {
  for (const stage of ["done", "in_progress", "responded"] as const) {
    if (STAGE_GOVERNMENT[stage].includes(state.government)) return stage
  }
  // Not sent yet: verified only
  return state.advocacy === "monitoring" ? "verified" : "referred"
}

export const ISSUE_ACTIONS = [
  "refer",
  "escalate",
  "record_response",
  "mark_in_progress",
  "confirm_resolved",
  "reopen",
  "mark_not_competent",
  "mark_not_followed_up",
  "close",
] as const
export type IssueAction = (typeof ISSUE_ACTIONS)[number]

export const VERIFICATION_LABELS = ["verified", "unverified"] as const
export type VerificationLabel = (typeof VERIFICATION_LABELS)[number]

// Tuntutan lifecycle, admin authored
export const DEMAND_STATES = ["draft", "published", "closed"] as const
export type DemandState = (typeof DEMAND_STATES)[number]

export const DEMAND_ACTIONS = ["publish", "close", "reopen"] as const
export type DemandAction = (typeof DEMAND_ACTIONS)[number]

// Sub-tuntutan axes, mockup labels
export const RESPONSE_STATUSES = ["not_responded", "responded"] as const
export type ResponseStatus = (typeof RESPONSE_STATUSES)[number]

export const FULFILMENT_STATUSES = [
  "not_fulfilled",
  "partially_fulfilled",
  "fulfilled",
  "rejected",
] as const
export type FulfilmentStatus = (typeof FULFILMENT_STATUSES)[number]

export type DemandItemState = {
  response: ResponseStatus
  fulfilment: FulfilmentStatus
}

export const VISIBILITY_ACTIONS = [
  "take_down",
  "redact",
  "unpublish",
  "merge_issue",
  "remove_on_request",
] as const
export type VisibilityAction = (typeof VISIBILITY_ACTIONS)[number]

export type EmailTemplate =
  | `report_${ReportStatus}`
  | `issue_${IssueAction}`
  | `demand_${DemandAction}`
  | "demand_update"

type FollowUp = {
  kind: "email"
  recipient: "reporter" | "followers"
  template: EmailTemplate
}

export type Transition<S> = { next: S; followUps: readonly FollowUp[] }

export class TransitionError extends Error {
  readonly machine: "report" | "issue" | "demand" | "demand_item"
  readonly from: string
  readonly action: string

  constructor(
    machine: TransitionError["machine"],
    from: string,
    action: string,
  ) {
    super(`${machine}: ${action} not allowed from ${from}`)
    this.name = "TransitionError"
    this.machine = machine
    this.from = from
    this.action = action
  }
}

type Rule<S> = { readonly from: readonly S[]; readonly to: S }

export const REPORT_TRANSITIONS: Readonly<
  Record<ReportAction, Rule<ReportStatus>>
> = {
  // Decided straight from Terkirim
  verify: { from: ["submitted", "in_review", "unverifiable"], to: "verified" },
  mark_unverifiable: { from: ["submitted", "in_review"], to: "unverifiable" },
  reject: { from: ["submitted", "in_review", "unverifiable"], to: "rejected" },
  // Only verified goes public
  merge: { from: ["verified"], to: "merged" },
}

export function canTransitionReport(
  from: ReportStatus,
  action: ReportAction,
): boolean {
  return REPORT_TRANSITIONS[action].from.includes(from)
}

export function allowedReportActions(from: ReportStatus): ReportAction[] {
  return REPORT_ACTIONS.filter((action) => canTransitionReport(from, action))
}

export function transitionReport(
  from: ReportStatus,
  action: ReportAction,
): Transition<ReportStatus> {
  if (!canTransitionReport(from, action)) {
    throw new TransitionError("report", from, action)
  }
  const next = REPORT_TRANSITIONS[action].to
  return {
    next,
    followUps: [
      { kind: "email", recipient: "reporter", template: `report_${next}` },
    ],
  }
}

// Omitted "to" keeps the axis.
// keep: states left unchanged
type AxisRule<S> = {
  readonly from: readonly S[]
  readonly to?: S
  readonly keep?: readonly S[]
}
type IssueRule = {
  readonly advocacy?: AxisRule<AdvocacyStatus>
  readonly government: AxisRule<GovernmentStatus>
}

const AFTER_REFERRAL: readonly AdvocacyStatus[] = ["referred", "escalated"]
const OPEN: readonly GovernmentStatus[] = [
  "awaiting_response",
  "responded",
  "in_progress",
  "reopened",
  "not_competent",
  "not_followed_up",
]

const ISSUE_TRANSITIONS: Readonly<Record<IssueAction, IssueRule>> = {
  refer: {
    // Escalation stays on re-referral
    advocacy: {
      from: ["monitoring", "referred", "escalated"],
      to: "referred",
      keep: ["escalated"],
    },
    government: {
      from: [
        "awaiting_response",
        "not_competent",
        "not_followed_up",
        "reopened",
      ],
      to: "awaiting_response",
    },
  },
  escalate: {
    advocacy: { from: AFTER_REFERRAL, to: "escalated" },
    government: { from: OPEN },
  },
  record_response: {
    government: {
      from: ["awaiting_response", "responded", "not_followed_up", "reopened"],
      to: "responded",
    },
  },
  mark_in_progress: {
    government: {
      from: ["awaiting_response", "responded", "reopened"],
      to: "in_progress",
    },
  },
  // Admin checks, one step
  confirm_resolved: {
    government: {
      from: [
        "awaiting_response",
        "responded",
        "in_progress",
        "reopened",
        "not_followed_up",
        "claimed_resolved",
      ],
      to: "confirmed_resolved",
    },
  },
  reopen: { government: { from: ["claimed_resolved"], to: "reopened" } },
  mark_not_competent: {
    advocacy: { from: AFTER_REFERRAL },
    government: {
      from: ["awaiting_response", "responded"],
      to: "not_competent",
    },
  },
  mark_not_followed_up: {
    advocacy: { from: AFTER_REFERRAL },
    government: {
      from: ["awaiting_response", "responded", "in_progress", "reopened"],
      to: "not_followed_up",
    },
  },
  close: { government: { from: OPEN, to: "closed" } },
}

export const TERMINAL_GOVERNMENT: readonly GovernmentStatus[] = [
  "confirmed_resolved",
  "closed",
]

/** No action leaves these. */
export function isTerminalIssue(government: GovernmentStatus): boolean {
  return TERMINAL_GOVERNMENT.includes(government)
}

export const INITIAL_ISSUE_STATE: IssueState = {
  advocacy: "monitoring",
  government: "awaiting_response",
}

export function canTransitionIssue(
  state: IssueState,
  action: IssueAction,
): boolean {
  const rule = ISSUE_TRANSITIONS[action]
  if (rule.advocacy && !rule.advocacy.from.includes(state.advocacy)) {
    return false
  }
  return rule.government.from.includes(state.government)
}

export function allowedIssueActions(state: IssueState): IssueAction[] {
  return ISSUE_ACTIONS.filter((action) => canTransitionIssue(state, action))
}

export function transitionIssue(
  state: IssueState,
  action: IssueAction,
): Transition<IssueState> {
  if (!canTransitionIssue(state, action)) {
    const from = `${state.advocacy}/${state.government}`
    throw new TransitionError("issue", from, action)
  }
  const rule = ISSUE_TRANSITIONS[action]
  const keep = rule.advocacy?.keep?.includes(state.advocacy) ?? false
  return {
    next: {
      advocacy: keep ? state.advocacy : (rule.advocacy?.to ?? state.advocacy),
      government: rule.government.to ?? state.government,
    },
    followUps: [
      { kind: "email", recipient: "followers", template: `issue_${action}` },
    ],
  }
}

/** At least one verified report. */
export function verificationLabel(verifiedReports: number): VerificationLabel {
  return verifiedReports > 0 ? "verified" : "unverified"
}

const DEMAND_TRANSITIONS: Readonly<Record<DemandAction, Rule<DemandState>>> = {
  publish: { from: ["draft"], to: "published" },
  close: { from: ["published"], to: "closed" },
  reopen: { from: ["closed"], to: "published" },
}

export function canTransitionDemand(
  from: DemandState,
  action: DemandAction,
): boolean {
  return DEMAND_TRANSITIONS[action].from.includes(from)
}

export function transitionDemand(
  from: DemandState,
  action: DemandAction,
): Transition<DemandState> {
  if (!canTransitionDemand(from, action)) {
    throw new TransitionError("demand", from, action)
  }
  return {
    next: DEMAND_TRANSITIONS[action].to,
    followUps: [
      { kind: "email", recipient: "followers", template: `demand_${action}` },
    ],
  }
}

/** One axis moves, response stays. */
export function canUpdateDemandItem(
  from: DemandItemState,
  to: DemandItemState,
): boolean {
  if (from.response === to.response && from.fulfilment === to.fulfilment) {
    return false
  }
  if (from.response === "responded" && to.response === "not_responded") {
    return false
  }
  // A rejection is a response
  return to.fulfilment !== "rejected" || to.response === "responded"
}

export function transitionDemandItem(
  from: DemandItemState,
  to: DemandItemState,
): Transition<DemandItemState> {
  if (!canUpdateDemandItem(from, to)) {
    const at = (s: DemandItemState) => `${s.response}/${s.fulfilment}`
    throw new TransitionError("demand_item", at(from), at(to))
  }
  return {
    next: { response: to.response, fulfilment: to.fulfilment },
    followUps: [
      { kind: "email", recipient: "followers", template: "demand_update" },
    ],
  }
}

export type DemandProgress = {
  total: number
  responded: number
  fulfilled: number
  partial: number
  rejected: number
  open: number
  // Derived, never typed
  status: FulfilmentStatus
}

/** Tuntutan status from its items. */
export function demandProgress(
  items: readonly DemandItemState[],
): DemandProgress {
  const count = (status: FulfilmentStatus) =>
    items.filter((item) => item.fulfilment === status).length
  const total = items.length
  const fulfilled = count("fulfilled")
  const partial = count("partially_fulfilled")
  const rejected = count("rejected")
  let status: FulfilmentStatus = "not_fulfilled"
  if (total > 0 && fulfilled === total) status = "fulfilled"
  else if (total > 0 && rejected === total) status = "rejected"
  else if (fulfilled + partial > 0) status = "partially_fulfilled"
  return {
    total,
    responded: items.filter((item) => item.response === "responded").length,
    fulfilled,
    partial,
    rejected,
    open: count("not_fulfilled"),
    status,
  }
}

const VISIBILITY_SET = new Set<string>(VISIBILITY_ACTIONS)

/** Triggers takedown job, hostname purge. */
export function reducesVisibility(action: string): action is VisibilityAction {
  return VISIBILITY_SET.has(action)
}
