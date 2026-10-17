import { Container } from "~/components/ui/container"
import { m } from "~/paraglide/messages.js"
import {
  MIN_PUBLIC_N,
  REFRESH_MINUTES,
  VERIFY_WINDOW_DAYS,
} from "../../../shared/dashboard.ts"
import { formatDate, formatDateTime } from "../../../shared/format.ts"
import { HIDDEN_MAX } from "./format"
import { METHOD_CHANGES, type MethodChange } from "./method-changes"

type DataFacts = { operator: string; campus: string; url: string }

type AboutProps = {
  facts: DataFacts
  computedAt: string
  nextAt: string
  firstReportAt: string | null
  changes?: readonly MethodChange[]
}

const TERM = "font-semibold"
const DESC = "mt-1 text-ink-soft leading-relaxed"

// PLAN §5.8 chart notes, once
export function AboutData({
  facts,
  computedAt,
  nextAt,
  firstReportAt,
  changes = METHOD_CHANGES,
}: AboutProps) {
  const computed = formatDateTime(new Date(computedAt))
  const items = [
    {
      term: m.data_about_source_label(),
      desc: m.data_about_source({ campus: facts.campus }),
    },
    {
      term: m.data_about_period_label(),
      desc: firstReportAt
        ? m.data_period_since({ date: formatDate(new Date(firstReportAt)) })
        : m.data_period_none(),
    },
    { term: m.data_about_updated_label(), desc: `${computed} WIB` },
    {
      term: m.data_about_next_label(),
      desc: m.data_about_next({
        minutes: REFRESH_MINUTES,
        time: formatDateTime(new Date(nextAt)),
      }),
    },
    { term: m.data_about_owner_label(), desc: facts.operator },
    {
      term: m.data_about_method_label(),
      desc: m.data_about_method({
        minutes: REFRESH_MINUTES,
        max: HIDDEN_MAX,
        min: MIN_PUBLIC_N,
      }),
    },
    {
      term: m.data_method_changes_label(),
      desc:
        changes.length === 0 ? (
          m.data_method_none()
        ) : (
          <ul className="list-disc space-y-1 pl-5">
            {changes.map((change) => (
              <li key={`${change.on}-${change.text()}`}>
                {m.data_method_entry({
                  date: formatDate(new Date(change.on)),
                  text: change.text(),
                })}
              </li>
            ))}
          </ul>
        ),
    },
    {
      term: m.data_about_cite_label(),
      desc: m.data_about_cite({
        operator: facts.operator,
        campus: facts.campus,
        url: facts.url,
        time: computed,
      }),
    },
  ]
  const definitions = [
    { term: m.data_key_reports(), desc: m.data_def_reports() },
    { term: m.data_key_verified(), desc: m.data_def_verified() },
    { term: m.data_key_issues(), desc: m.data_def_issues() },
    { term: m.data_key_ratio(), desc: m.data_def_ratio() },
    { term: m.data_resolution_label(), desc: m.data_def_resolution() },
    {
      term: m.data_verify_term(),
      desc: m.data_def_verify_time({ days: VERIFY_WINDOW_DAYS }),
    },
    { term: m.data_queue_term(), desc: m.data_def_queue() },
    { term: m.data_key_demands(), desc: m.data_def_demands() },
    { term: m.data_key_demands_active(), desc: m.data_def_demands_active() },
    {
      term: m.data_key_demands_fulfilled(),
      desc: m.data_def_demands_fulfilled(),
    },
  ]
  return (
    <section aria-labelledby="tentang-data" id="metode" className="pb-16">
      <Container>
        <h2
          id="tentang-data"
          className="font-bold font-heading text-[clamp(2rem,4.4vw,3rem)] text-ink leading-[1.1] [font-synthesis-weight:none]"
        >
          {m.data_about_title()}
        </h2>
        <div className="mt-8 grid gap-10 lg:grid-cols-2">
          <dl className="border-ink border-t-2">
            {items.map((item) => (
              <div key={item.term} className="border-line-subtle border-b py-3">
                <dt className={TERM}>{item.term}</dt>
                <dd className={DESC}>{item.desc}</dd>
              </div>
            ))}
          </dl>
          <div>
            <h3 className="font-bold text-xl">{m.data_defs_title()}</h3>
            <dl className="mt-3 border-ink border-t-2">
              {definitions.map((item) => (
                <div
                  key={item.term}
                  className="border-line-subtle border-b py-3"
                >
                  <dt className={TERM}>{item.term}</dt>
                  <dd className={DESC}>{item.desc}</dd>
                </div>
              ))}
            </dl>
            <h3 className="mt-8 font-bold text-xl">{m.data_pending_title()}</h3>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-ink-soft">
              <li>{m.data_pending_capita()}</li>
              <li>{m.data_pending_regency()}</li>
            </ul>
          </div>
        </div>
      </Container>
    </section>
  )
}
