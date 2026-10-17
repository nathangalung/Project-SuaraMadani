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
import {
  APPEAL_WINDOW_DAYS,
  COMPLAINT_SLA_DAYS,
} from "../../../shared/complaints.ts"

// Draft, legal review before launch
const UPDATED = "2026-10-15"

const CATEGORIES = [
  [m.category_program, m.category_program_hint],
  [m.category_bencana, m.category_bencana_hint],
  [m.category_bansos, m.category_bansos_hint],
] as const

// Numbered, reason codes cite them
const STANDARDS = [
  m.guidelines_standard_1,
  m.guidelines_standard_2,
  m.guidelines_standard_3,
  m.guidelines_standard_4,
  m.guidelines_standard_5,
  m.guidelines_standard_6,
  m.guidelines_standard_7,
  m.guidelines_standard_8,
  m.guidelines_standard_9,
  m.guidelines_standard_10,
  m.guidelines_standard_11,
  m.guidelines_standard_12,
  m.guidelines_standard_13,
]

// Same items admins tick
const CHECKLIST = [
  m.checklist_no_personal_data,
  m.checklist_region_matches,
  m.checklist_category_complete,
  m.checklist_label_checked,
]

export default function Guidelines() {
  const operator = useIdentity()?.operator ?? ""
  const national = useNational()
  const sections: PolicySection[] = [
    {
      id: "cakupan",
      title: m.guidelines_scope_title(),
      body: (
        <>
          <Prose>{m.guidelines_scope_body()}</Prose>
          <ul className={PROSE_LIST}>
            {CATEGORIES.map(([name, hint]) => (
              <li key={name()}>
                <span className="block font-semibold">{name()}</span>
                {hint()}
              </li>
            ))}
          </ul>
          <Prose>{m.guidelines_scope_age()}</Prose>
          <Prose>{m.report_emergency()}</Prose>
        </>
      ),
    },
    {
      id: "standar",
      title: m.guidelines_standards_title(),
      body: (
        <>
          <Prose>{m.guidelines_standards_intro()}</Prose>
          <ol className="mt-3 list-decimal space-y-2 pl-6 leading-relaxed marker:font-semibold marker:text-accent">
            {STANDARDS.map((standard, index) => (
              <li key={standard()} id={`standar-${index + 1}`}>
                {standard()}
              </li>
            ))}
          </ol>
        </>
      ),
    },
    {
      id: "pemeriksaan",
      title: m.guidelines_review_title(),
      body: (
        <>
          <Prose>{m.guidelines_review_body({ operator })}</Prose>
          <Prose>{m.guidelines_review_checklist()}</Prose>
          <ul className={PROSE_LIST}>
            {CHECKLIST.map((item) => (
              <li key={item()}>{item()}</li>
            ))}
          </ul>
        </>
      ),
    },
    {
      id: "tidak-terbit",
      title: m.guidelines_rejected_title(),
      body: (
        <Prose>
          {m.guidelines_rejected_body({
            status: m.report_status_rejected(),
          })}
        </Prose>
      ),
    },
    {
      id: "nonpartisan",
      title: m.guidelines_nonpartisan_title(),
      body: <Prose>{m.guidelines_nonpartisan_body()}</Prose>,
    },
    {
      id: "hak-jawab",
      title: m.guidelines_reply_title(),
      body: (
        <>
          <Prose>{m.guidelines_reply_body()}</Prose>
          <ContactLine />
        </>
      ),
    },
    {
      id: "aduan",
      title: m.guidelines_complaint_title(),
      body: (
        <>
          <Prose>{m.guidelines_complaint_body()}</Prose>
          <Prose>
            {m.guidelines_complaint_sla({ days: COMPLAINT_SLA_DAYS })}
          </Prose>
          <Prose>
            {m.guidelines_complaint_appeal({ days: APPEAL_WINDOW_DAYS })}
          </Prose>
        </>
      ),
    },
    {
      id: "perintah",
      title: m.guidelines_orders_title(),
      body: <Prose>{m.guidelines_orders_body()}</Prose>,
    },
    {
      id: "perubahan",
      title: m.guidelines_changes_title(),
      body: <Prose>{m.guidelines_changes_body()}</Prose>,
    },
  ]
  return (
    <>
      <title>{useSiteTitle(m.guidelines_title())}</title>
      <PolicyPage
        national={national}
        title={m.guidelines_title()}
        lead={m.guidelines_lead()}
        updated={UPDATED}
        sections={sections}
      />
    </>
  )
}
