import type { ReactNode } from "react"
import { PageHeader } from "~/components/layout/page-header"
import { ReportButton, useNational } from "~/features/content/policy-page"
import { useSiteTitle } from "~/features/report/page-title"
import { m } from "~/paraglide/messages.js"

const METHODS = [m.about_method_1, m.about_method_2, m.about_method_3]

function principles() {
  return [
    {
      title: m.about_principle_1_title(),
      body: m.about_principle_1_body(),
    },
    {
      title: m.about_principle_2_title(),
      body: m.about_principle_2_body(),
    },
    {
      title: m.about_principle_3_title(),
      body: m.about_principle_3_body(),
    },
    {
      title: m.about_principle_4_title(),
      body: m.about_principle_4_body(),
    },
  ]
}

function steps() {
  return [
    { title: m.about_step_1_title(), body: m.about_step_1_body() },
    { title: m.about_step_2_title(), body: m.about_step_2_body() },
    { title: m.about_step_3_title(), body: m.about_step_3_body() },
    { title: m.about_step_4_title(), body: m.about_step_4_body() },
  ]
}

/** Title and line, two columns. */
function ItemGrid({
  items,
  ordered = false,
}: {
  items: { title: string; body: string }[]
  ordered?: boolean
}) {
  const List = ordered ? "ol" : "ul"
  return (
    <List className="grid gap-x-10 gap-y-8 sm:grid-cols-2">
      {items.map((item) => (
        <li key={item.title}>
          <h3 className="font-bold font-ui text-lg leading-snug">
            {item.title}
          </h3>
          <p className="mt-1 text-ink-muted leading-relaxed">{item.body}</p>
        </li>
      ))}
    </List>
  )
}

/** Statement left, content right. */
function Split({
  id,
  label,
  statement,
  children,
}: {
  id: string
  label: string
  statement: string
  children: ReactNode
}) {
  return (
    <section
      aria-labelledby={id}
      className="grid gap-x-12 gap-y-8 py-14 lg:grid-cols-12 lg:items-center lg:py-20"
    >
      <div className="lg:col-span-5">
        <h2
          id={id}
          className="inline-block bg-highlight px-2 py-0.5 font-bold font-heading text-ink text-lg [font-synthesis-weight:none]"
        >
          {label}
        </h2>
        <p className="mt-5 text-balance font-bold font-heading text-[clamp(1.75rem,3.2vw,2.5rem)] text-ink leading-tight [font-synthesis-weight:none]">
          {statement}
        </p>
      </div>
      <div className="lg:col-span-7">{children}</div>
    </section>
  )
}

// Editorial split, Change.org pattern
export default function About() {
  const national = useNational()
  return (
    <>
      <title>{useSiteTitle(m.nav_about())}</title>
      {/* Same header as /lapor */}
      <PageHeader title={m.about_title()} description={m.about_lead()} />
      <div className="mx-auto mt-6 max-w-6xl px-6 pb-10 text-ink sm:px-10">
        <Split
          id="prinsip"
          label={m.about_principles_title()}
          statement={m.about_principles_statement()}
        >
          <ItemGrid items={principles()} />
        </Split>

        <Split
          id="cara-kerja"
          label={m.home_how_title()}
          statement={m.about_how_statement()}
        >
          {/* The ol keeps step order */}
          <ItemGrid items={steps()} ordered />
        </Split>

        <Split
          id="metode"
          label={m.about_method_title()}
          statement={m.about_method_lead()}
        >
          <ul className="grid gap-5">
            {METHODS.map((line) => (
              <li
                key={line()}
                className="font-semibold font-ui text-lg leading-snug"
              >
                {line()}
              </li>
            ))}
          </ul>
        </Split>

        {/* One closing call to act */}
        <div className="flex justify-center pt-4 pb-10 lg:pt-8">
          <ReportButton national={national} variant="highlight" />
        </div>
      </div>
    </>
  )
}
