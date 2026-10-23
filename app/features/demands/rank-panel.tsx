import { Link } from "react-router"
import { SECTION_TITLE } from "~/components/layout/section-heading"
import { m } from "~/paraglide/messages.js"
import {
  type DemandRank,
  RANKING_ACCOUNT_DAYS,
  RANKING_MIN_RANKERS,
} from "../../../shared/demands.ts"
import { formatNumber } from "../../../shared/format.ts"
import type { OwnPosition } from "./ranking.server"

const LINK =
  "font-semibold text-accent underline underline-offset-4 hover:no-underline"

/** Citizen place, own place, link. */
export function RankPanel({
  rank,
  ranking,
  own,
  signedIn,
}: {
  rank: DemandRank
  ranking: { rankers: number; ranked: number; shown: boolean }
  own: OwnPosition | null
  signedIn: boolean
}) {
  return (
    <section id="peringkat-warga" aria-labelledby="peringkat-warga-title">
      <h2 id="peringkat-warga-title" className={SECTION_TITLE}>
        {m.demand_rank_title()}
      </h2>
      <p className="mt-1 font-ui text-[0.95rem] text-ink-soft">
        {m.demand_rank_intro()}
      </p>
      {!ranking.shown ? (
        <p className="mt-5 font-semibold">
          {m.demand_rank_few({
            min: RANKING_MIN_RANKERS,
            rankers: formatNumber(ranking.rankers),
          })}
        </p>
      ) : rank.place === null ? (
        <p className="mt-5 font-semibold">{m.demand_rank_unranked()}</p>
      ) : (
        <p className="mt-5">
          <span className="font-bold font-heading text-3xl text-ink [font-synthesis-weight:none]">
            #{formatNumber(rank.place)}
          </span>{" "}
          <span className="font-semibold">
            {m.demand_rank_place({
              place: formatNumber(rank.place),
              total: formatNumber(ranking.ranked),
            })}
          </span>{" "}
          <span className="text-ink-soft">
            {m.demand_rank_chosen({ rankers: formatNumber(rank.rankers) })}
          </span>
        </p>
      )}
      {own ? (
        <p className="mt-4 text-ink-soft text-sm">
          {own.position === null
            ? m.demand_rank_own_none()
            : m.demand_rank_own({ position: own.position })}
          {own.saved && !own.counted
            ? ` ${m.demand_rank_own_pending({ days: RANKING_ACCOUNT_DAYS })}`
            : null}
        </p>
      ) : null}
      <Link to="/tuntutan/peringkat" className={`mt-4 inline-block ${LINK}`}>
        {!signedIn
          ? m.demand_rank_action_sign_in()
          : own?.saved
            ? m.demand_rank_change()
            : m.demand_rank_action()}
      </Link>
    </section>
  )
}
