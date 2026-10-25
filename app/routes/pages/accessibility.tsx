import {
  ContactLine,
  PolicyPage,
  type PolicySection,
  Prose,
} from "~/features/content/policy-page"
import { PROSE_LIST } from "~/features/content/prose"
import { useSiteTitle } from "~/features/report/page-title"
import { m } from "~/paraglide/messages.js"

// Bump after each review
const UPDATED = "2026-10-16"

const DONE = [
  m.accessibility_done_1,
  m.accessibility_done_2,
  m.accessibility_done_3,
  m.accessibility_done_4,
  m.accessibility_done_5,
]

const LIMITS = [m.accessibility_limits_1, m.accessibility_limits_2]

function List({ items }: { items: readonly (() => string)[] }) {
  return (
    <ul className={PROSE_LIST}>
      {items.map((item) => (
        <li key={item()}>{item()}</li>
      ))}
    </ul>
  )
}

/** PLAN §6.1 footer statement. */
export default function Accessibility() {
  const sections: PolicySection[] = [
    {
      id: "standar",
      title: m.accessibility_standard_title(),
      body: <Prose>{m.accessibility_standard_body()}</Prose>,
    },
    {
      id: "upaya",
      title: m.accessibility_done_title(),
      body: <List items={DONE} />,
    },
    {
      id: "batasan",
      title: m.accessibility_limits_title(),
      body: <List items={LIMITS} />,
    },
    {
      id: "kendala",
      title: m.accessibility_contact_title(),
      body: (
        <>
          <Prose>{m.accessibility_contact_body()}</Prose>
          <ContactLine />
        </>
      ),
    },
  ]
  return (
    <>
      <title>{useSiteTitle(m.accessibility_title())}</title>
      <PolicyPage
        title={m.accessibility_title()}
        lead={m.accessibility_lead()}
        updated={UPDATED}
        sections={sections}
      />
    </>
  )
}
