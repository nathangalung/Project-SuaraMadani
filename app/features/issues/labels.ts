// Explicit maps keep tree-shaking
import { m } from "~/paraglide/messages.js"
import type {
  EscalationChannel,
  ReferralChannel,
} from "../../../shared/moderation.ts"
import type {
  AdvocacyStatus,
  GovernmentStatus,
  VerificationLabel,
} from "../../../shared/status.ts"

type Text = () => string

export const VERIFICATION_TEXT: Record<VerificationLabel, Text> = {
  verified: m.verification_verified,
  unverified: m.verification_unverified,
}

export const ADVOCACY_TEXT: Record<AdvocacyStatus, Text> = {
  monitoring: m.advocacy_monitoring,
  referred: m.advocacy_referred,
  escalated: m.advocacy_escalated,
}

export const GOVERNMENT_TEXT: Record<GovernmentStatus, Text> = {
  awaiting_response: m.gov_awaiting_response,
  responded: m.gov_responded,
  in_progress: m.gov_in_progress,
  claimed_resolved: m.gov_claimed_resolved,
  confirmed_resolved: m.gov_confirmed_resolved,
  reopened: m.gov_reopened,
  not_competent: m.gov_not_competent,
  not_followed_up: m.gov_not_followed_up,
  closed: m.gov_closed,
}

export const CHANNEL_TEXT: Record<ReferralChannel | EscalationChannel, Text> = {
  official_letter: m.channel_official_letter,
  agency_email: m.channel_agency_email,
  agency_service: m.channel_agency_service,
  hearing: m.channel_hearing,
  ombudsman: m.channel_ombudsman,
  dprd: m.channel_dprd,
  media: m.channel_media,
}
