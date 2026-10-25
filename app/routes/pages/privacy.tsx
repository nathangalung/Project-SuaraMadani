import {
  ContactLine,
  PolicyPage,
  type PolicySection,
  Prose,
  useIdentity,
  useNational,
} from "~/features/content/policy-page"
import { PROSE_LIST } from "~/features/content/prose"
import { useSiteTitle } from "~/features/report/page-title"
import { m } from "~/paraglide/messages.js"
import { DISTRICT_MIN_REPORTS } from "../../../shared/report-fields.ts"
import type { Route } from "./+types/privacy"

// Draft, legal review before launch
const UPDATED = "2026-10-25"

// Server constant, no client chunk
export function loader() {
  return { districtMin: String(DISTRICT_MIN_REPORTS) }
}

function List({ items }: { items: readonly (() => string)[] }) {
  return (
    <ul className={PROSE_LIST}>
      {items.map((item) => (
        <li key={item()}>{item()}</li>
      ))}
    </ul>
  )
}

export default function Privacy({ loaderData }: Route.ComponentProps) {
  const identity = useIdentity()
  const operator = identity?.operator ?? ""
  const national = useNational()
  const campus = identity?.campus ?? ""
  const sections: PolicySection[] = [
    {
      id: "pengelola",
      title: m.privacy_controller_title(),
      body: (
        <>
          <Prose>
            {national
              ? m.privacy_controller_body_national()
              : m.privacy_controller_body({ operator, campus })}
          </Prose>
        </>
      ),
    },
    {
      id: "data",
      title: m.privacy_data_title(),
      body: (
        <>
          <List
            items={[
              m.privacy_data_account,
              m.privacy_data_report,
              m.privacy_data_point,
              m.privacy_data_evidence,
              m.privacy_data_contact,
              m.privacy_data_consent,
              m.privacy_data_follow,
              m.privacy_data_ranking,
              m.privacy_data_technical,
            ]}
          />
          <Prose>{m.signin_privacy_note()}</Prose>
        </>
      ),
    },
    {
      id: "tujuan",
      title: m.privacy_use_title(),
      body: (
        <>
          <List
            items={[
              m.privacy_use_review,
              m.privacy_use_issue,
              m.privacy_use_aggregate,
              m.privacy_use_email,
              m.privacy_use_identity,
              m.privacy_use_security,
            ]}
          />
          <Prose>{m.privacy_basis()}</Prose>
          <Prose>{m.privacy_access_body()}</Prose>
        </>
      ),
    },
    {
      id: "publik",
      title: m.privacy_public_title(),
      body: (
        <>
          <Prose>{m.privacy_public_body()}</Prose>
          <Prose>
            {m.privacy_public_location({ count: loaderData.districtMin })}
          </Prose>
          <Prose>{m.privacy_public_evidence_copy()}</Prose>
        </>
      ),
    },
    {
      id: "usia",
      title: m.privacy_age_title(),
      body: <Prose>{m.privacy_age_body()}</Prose>,
    },
    {
      id: "keamanan",
      title: m.privacy_security_title(),
      body: (
        <List
          items={[m.privacy_security_contacts, m.privacy_security_originals]}
        />
      ),
    },
    {
      id: "kebocoran",
      title: m.privacy_breach_title(),
      body: <Prose>{m.privacy_breach_body()}</Prose>,
    },
    {
      id: "hak",
      title: m.privacy_rights_title(),
      body: (
        <>
          <Prose>{m.privacy_rights_intro()}</Prose>
          <List
            items={[
              m.privacy_right_access,
              m.privacy_right_correct,
              m.privacy_right_delete,
              m.privacy_right_withdraw,
            ]}
          />
          <ContactLine />
        </>
      ),
    },
  ]
  return (
    <>
      <title>{useSiteTitle(m.privacy_title())}</title>
      <PolicyPage
        title={m.privacy_title()}
        lead={m.privacy_lead()}
        updated={UPDATED}
        sections={sections}
      />
    </>
  )
}
