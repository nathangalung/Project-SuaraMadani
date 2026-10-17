import type { ReactNode } from "react"
import { useRouteLoaderData } from "react-router"
import { PageHeader } from "~/components/layout/page-header"
import { ButtonLink } from "~/components/ui/button"
import { Container } from "~/components/ui/container"
import { m } from "~/paraglide/messages.js"
import type { loader as rootLoader } from "~/root"
import { PROSE_LINK, updatedOn } from "./prose"

export type PolicySection = { id: string; title: string; body: ReactNode }

/** Apex host, from the shell. */
export function useNational(): boolean {
  return useRouteLoaderData<typeof rootLoader>("root")?.national === true
}

/** Apex: pick a campus. */
export function ReportButton({
  national,
  variant,
}: {
  national: boolean
  variant?: "primary" | "highlight"
}) {
  return national ? (
    <ButtonLink to="/#kampus" variant={variant} size="lg">
      {m.national_choose_campus()}
    </ButtonLink>
  ) : (
    <ButtonLink to="/lapor" variant={variant} size="lg">
      {m.report_start()}
    </ButtonLink>
  )
}

/** Operator facts from the shell. */
export function useIdentity() {
  return useRouteLoaderData<typeof rootLoader>("root")?.identity
}

// Email when set, else operator
export function ContactLine() {
  const identity = useIdentity()
  if (!identity) return null
  const { contactEmail, operator } = identity
  return (
    <p className="mt-3 leading-relaxed">
      {contactEmail ? (
        <>
          {m.policy_contact_email()}{" "}
          <a href={`mailto:${contactEmail}`} className={PROSE_LINK}>
            {contactEmail}
          </a>
          .
        </>
      ) : (
        m.policy_contact_operator({ operator })
      )}
    </p>
  )
}

// Docs layout, anchors without JS
export function PolicyPage({
  title,
  lead,
  updated,
  sections,
  national = false,
}: {
  title: string
  lead: string
  updated: string
  sections: PolicySection[]
  national?: boolean
}) {
  return (
    <>
      <PageHeader title={title} description={lead}>
        <p className="mt-4 font-ui text-ink-muted text-sm">
          {m.policy_updated({ date: updatedOn(updated) })}
        </p>
      </PageHeader>
      <Container className="grid gap-10 pt-10 pb-24 lg:grid-cols-[15rem_1fr] lg:gap-16">
        <nav aria-labelledby="policy-on-page" className="lg:pt-6">
          <div className="lg:sticky lg:top-28">
            <h2 id="policy-on-page" className="font-bold text-lg">
              {m.issue_on_this_page()}
            </h2>
            <ol className="mt-3 flex flex-col gap-2 border-ink border-l-2 pl-4 font-ui">
              {sections.map((section) => (
                <li key={section.id}>
                  <a
                    href={`#${section.id}`}
                    className="underline-offset-4 hover:underline"
                  >
                    {section.title}
                  </a>
                </li>
              ))}
            </ol>
          </div>
        </nav>
        <div className="min-w-0 max-w-3xl space-y-12">
          {sections.map((section) => (
            <section
              key={section.id}
              id={section.id}
              aria-labelledby={`${section.id}-title`}
              className="border-ink border-t-2 pt-6"
            >
              <h2 id={`${section.id}-title`} className="font-bold text-2xl">
                {section.title}
              </h2>
              {section.body}
            </section>
          ))}
          {/* One next step */}
          <p className="border-line-subtle border-t pt-8">
            <ReportButton national={national} />
          </p>
        </div>
      </Container>
    </>
  )
}

/** Paragraph with prose spacing. */
export function Prose({ children }: { children: ReactNode }) {
  return <p className="mt-3 leading-relaxed">{children}</p>
}
