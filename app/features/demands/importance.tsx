import { Link } from "react-router"
import { m } from "~/paraglide/messages.js"
import {
  IMPORTANCE_ACCOUNT_DAYS,
  IMPORTANCE_MIN_RATERS,
  IMPORTANCE_SCORES,
  type Importance,
  sharePercent,
} from "../../../shared/demands.ts"
import { formatDate, formatNumber } from "../../../shared/format.ts"
import { IMPORTANCE_TEXT } from "./importance-labels"
import { formatImportance } from "./importance-line"
import type { NamedRaters, OwnRating } from "./rating.server"

const LINK =
  "font-semibold text-accent underline underline-offset-4 hover:no-underline"

/** Detail section, no JS. */
export function ImportancePanel({
  code,
  importance,
  named,
  open,
  own,
  signedIn,
}: {
  code: string
  importance: Importance
  named: NamedRaters
  // Closed: score frozen
  open: boolean
  own: OwnRating | null
  signedIn: boolean
}) {
  const rate = `/tuntutan/${code}/nilai`
  return (
    <section
      id="kepentingan"
      aria-labelledby="kepentingan-title"
      className="border-ink border-t-2 pt-6"
    >
      <h2 id="kepentingan-title" className="font-bold text-2xl">
        {m.demand_importance_title()}
      </h2>
      <p className="mt-1 font-ui text-[0.95rem] text-ink-soft">
        {m.demand_importance_intro()}
      </p>
      {importance.mean === null ? (
        <p className="mt-5 font-semibold">
          {m.demand_importance_few({
            raters: formatNumber(importance.raters),
            min: IMPORTANCE_MIN_RATERS,
          })}
        </p>
      ) : (
        <>
          <p className="mt-5 flex flex-wrap items-baseline gap-x-3">
            <span className="font-bold text-5xl tabular-nums leading-none">
              {formatImportance(importance.mean)}
            </span>
            <span className="font-ui text-ink-soft">
              {m.demand_importance_of_five({
                raters: formatNumber(importance.raters),
              })}
            </span>
          </p>
          <table className="mt-5 w-full max-w-xl font-ui text-sm">
            <caption className="sr-only">{m.demand_importance_table()}</caption>
            <thead>
              <tr className="border-ink/15 border-b text-left text-ink-soft">
                <th scope="col" className="py-2 pr-3 font-semibold">
                  {m.demand_importance_col_score()}
                </th>
                <th scope="col" className="w-1/2 py-2 pr-3 font-semibold">
                  <span className="sr-only">
                    {m.demand_importance_col_bar()}
                  </span>
                </th>
                <th scope="col" className="py-2 pr-3 text-right font-semibold">
                  {m.demand_importance_col_raters()}
                </th>
                <th scope="col" className="py-2 text-right font-semibold">
                  {m.demand_importance_col_share()}
                </th>
              </tr>
            </thead>
            <tbody>
              {IMPORTANCE_SCORES.toReversed().map((score) => {
                const n = importance.counts[score]
                return (
                  <tr key={score} className="border-ink/10 border-b">
                    <th
                      scope="row"
                      className="whitespace-nowrap py-2 pr-3 text-left font-normal"
                    >
                      {score} · {IMPORTANCE_TEXT[score]()}
                    </th>
                    <td className="py-2 pr-3">
                      <span aria-hidden="true" className="block h-2.5 bg-ink/8">
                        <span
                          className="block h-full bg-brand"
                          style={{
                            width: `${(n / importance.raters) * 100}%`,
                          }}
                        />
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {formatNumber(n)}
                    </td>
                    <td className="whitespace-nowrap py-2 text-right tabular-nums">
                      {sharePercent(n, importance.raters)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </>
      )}
      <p className="mt-5 max-w-2xl text-ink-soft text-sm leading-relaxed">
        {m.demand_importance_rules({
          min: IMPORTANCE_MIN_RATERS,
          days: IMPORTANCE_ACCOUNT_DAYS,
        })}
      </p>
      {own ? (
        <p className="mt-4 font-semibold">
          {m.demand_importance_own({
            score: own.score,
            label: IMPORTANCE_TEXT[own.score](),
          })}{" "}
          <span className="font-normal text-ink-soft">
            {own.showName
              ? m.demand_importance_own_named()
              : m.demand_importance_own_anonymous()}
            {own.counted
              ? null
              : ` ${m.demand_importance_own_pending({ days: IMPORTANCE_ACCOUNT_DAYS })}`}
          </span>
        </p>
      ) : null}
      {open ? (
        <p className="mt-4">
          <Link to={rate} className={LINK}>
            {own
              ? m.demand_importance_change()
              : signedIn
                ? m.demand_importance_action()
                : m.demand_importance_action_sign_in()}
          </Link>
        </p>
      ) : (
        <p className="mt-4 text-ink-soft">{m.demand_importance_closed()}</p>
      )}
      {named.total > 0 ? (
        <>
          <h3 className="mt-8 font-bold text-lg">
            {m.demand_importance_named_title()}
          </h3>
          <p className="mt-1 font-ui text-[0.95rem] text-ink-soft">
            {m.demand_importance_named_intro()}
          </p>
          <ul className="mt-3 divide-y divide-line-subtle border-line-subtle border-y">
            {named.shown.map((rater) => (
              <li
                key={`${rater.name}-${rater.on.toISOString()}`}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5"
              >
                <span className="min-w-0 break-words font-semibold">
                  {rater.name}
                </span>
                <span className="font-ui text-ink-soft text-sm">
                  {m.demand_importance_named_row({
                    score: rater.score,
                    label: IMPORTANCE_TEXT[rater.score](),
                    date: formatDate(rater.on),
                  })}
                </span>
              </li>
            ))}
          </ul>
          {named.total > named.shown.length ? (
            <p className="mt-2 font-ui text-ink-soft text-sm">
              {m.demand_importance_named_more({
                count: formatNumber(named.total - named.shown.length),
              })}
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  )
}
