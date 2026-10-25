import {
  PolicyPage,
  type PolicySection,
  Prose,
} from "~/features/content/policy-page"
import { PROSE_LIST } from "~/features/content/prose"
import { useSiteTitle } from "~/features/report/page-title"
import { m } from "~/paraglide/messages.js"

// Draft, legal review before launch
const UPDATED = "2026-10-25"

const CATEGORIES = [
  [m.category_program, m.category_program_hint],
  [m.category_bencana, m.category_bencana_hint],
  [m.category_bansos, m.category_bansos_hint],
] as const

// Numbered, reason codes cite them
// Same items admins tick
const CHECKLIST = [
  m.checklist_no_personal_data,
  m.checklist_region_matches,
  m.checklist_category_complete,
  m.checklist_label_checked,
]

export default function Guidelines() {
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
      id: "pemeriksaan",
      title: m.guidelines_review_title(),
      body: (
        <>
          <Prose>{m.guidelines_review_body()}</Prose>
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
      id: "belum-terverifikasi",
      title: m.guidelines_rejected_title(),
      body: (
        <Prose>
          {m.guidelines_rejected_body({
            status: m.report_status_unverifiable(),
          })}
        </Prose>
      ),
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
        title={m.guidelines_title()}
        lead={m.guidelines_lead()}
        updated={UPDATED}
        sections={sections}
      />
    </>
  )
}
