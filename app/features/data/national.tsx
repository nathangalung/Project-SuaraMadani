import { ArrowUpRight } from "lucide-react"
import type { CSSProperties } from "react"
import { PageHeader } from "~/components/layout/page-header"
import { SectionHeading } from "~/components/layout/section-heading"
import { ButtonLink } from "~/components/ui/button"
import { Container } from "~/components/ui/container"
import { Note } from "~/components/ui/note"
import { Table, Td, Th } from "~/components/ui/table"
import { m } from "~/paraglide/messages.js"
import { type Count, REFRESH_MINUTES } from "../../../shared/dashboard.ts"
import { formatDateTime, formatNumber } from "../../../shared/format.ts"
import type { GovernmentStatus } from "../../../shared/status.ts"
import { GOVERNMENT_TEXT } from "../issues/labels"
import { CATEGORY_SHORT_TEXT } from "../report/category-labels"
import { CATEGORY_COLOR, SIDE_STATUS_COLOR, STATUS_RAMP } from "./chart-theme"
import { barWidth, countText, HIDDEN_MAX } from "./format"
import type {
  NationalCampus,
  NationalData,
  NationalView,
} from "./national.server"

const SECTION = "py-14 sm:py-20"
// Same backdrop as above
const FOLLOW_ON = "pb-14 sm:pb-20"
// Pipeline first, then exits
const PIPELINE: GovernmentStatus[] = [
  "awaiting_response",
  "responded",
  "in_progress",
  "confirmed_resolved",
]

function maxOf(counts: Count[]): number {
  return Math.max(0, ...counts.map((count) => count ?? 0))
}

function CampusCard({ campus }: { campus: NationalCampus }) {
  return (
    <a
      href={campus.href}
      className="group flex h-full items-start justify-between gap-4 rounded-2xl border border-line-subtle bg-surface-raised p-5 transition-colors hover:border-ink"
    >
      <span className="flex min-w-0 flex-col gap-1">
        <span className="font-bold text-xl">{campus.campusName}</span>
        <span className="text-ink-soft">{campus.name}</span>
        <span className="truncate text-ink-muted text-sm">{campus.host}</span>
      </span>
      <ArrowUpRight
        aria-hidden="true"
        className="mt-1 size-5 shrink-0 transition-transform duration-(--dur-hover) group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
      />
    </a>
  )
}

function Campuses({ campuses }: { campuses: NationalCampus[] }) {
  return (
    <section aria-labelledby="kampus" className={SECTION}>
      <Container>
        <SectionHeading
          id="kampus"
          title={m.national_campuses_title()}
          description={m.national_campuses_lead()}
          className="view-rise mb-10"
        />
        {campuses.length === 0 ? (
          <p className="mx-auto max-w-6xl text-ink-soft text-lg">
            {m.national_campuses_empty()}
          </p>
        ) : (
          <ul className="view-rise-list mx-auto grid max-w-6xl gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {campuses.map((campus, i) => (
              <li key={campus.id} style={{ "--i": i } as CSSProperties}>
                <CampusCard campus={campus} />
              </li>
            ))}
          </ul>
        )}
      </Container>
    </section>
  )
}

type Tile = { label: string; value: string; note?: string }

function KeyNumbers({
  total,
  demands,
}: {
  total: NationalData["total"]
  demands: NationalData["demands"]
}) {
  const tiles: Tile[] = [
    {
      label: m.national_key_campuses(),
      value: formatNumber(total.campuses),
    },
    { label: m.data_key_reports(), value: countText(total.received) },
    {
      label: m.data_key_issues(),
      value: countText(total.issues),
      note: m.data_key_issues_note({ n: countText(total.issueReports) }),
    },
    {
      label: m.national_key_resolved(),
      value: countText(total.resolved),
      note: m.national_key_resolved_note({ n: countText(total.issues) }),
    },
    // Public content, exact
    {
      label: m.data_key_demands(),
      value: formatNumber(demands.total),
      note: m.data_key_demands_note({
        national: formatNumber(demands.national),
        regional: formatNumber(demands.regional),
      }),
    },
    {
      label: m.data_key_demands_active(),
      value: formatNumber(demands.active),
      note: m.data_key_demands_active_note(),
    },
    {
      label: m.data_key_demands_fulfilled(),
      value: formatNumber(demands.fulfilled),
      note: m.data_key_demands_fulfilled_note(),
    },
    {
      label: m.data_key_items_fulfilled(),
      value: formatNumber(demands.itemsFulfilled),
      note: m.data_key_items_fulfilled_note({
        n: formatNumber(demands.items),
      }),
    },
  ]
  return (
    <section
      aria-labelledby="angka-utama"
      className="bg-ink text-surface-raised"
    >
      <Container className="py-12">
        <h2
          id="angka-utama"
          className="font-bold font-heading text-[clamp(2rem,4.4vw,3rem)] leading-[1.1] [font-synthesis-weight:none]"
        >
          {m.data_key_title()}
        </h2>
        <dl className="view-rise-list mt-8 grid grid-cols-2 gap-x-6 gap-y-8 md:grid-cols-4">
          {tiles.map((tile, i) => (
            <div
              key={tile.label}
              style={{ "--i": i } as CSSProperties}
              className="flex flex-col-reverse justify-end"
            >
              <dt className="mt-2 text-sm text-surface-raised/80">
                {tile.label}
                {tile.note && (
                  <span className="block text-surface-raised/70 text-xs">
                    {tile.note}
                  </span>
                )}
              </dt>
              <dd className="font-bold text-[clamp(2rem,4.4vw,3rem)] leading-none">
                {tile.value}
              </dd>
            </div>
          ))}
        </dl>
      </Container>
    </section>
  )
}

function CampusTable({ campuses }: { campuses: NationalCampus[] }) {
  return (
    <section aria-labelledby="angka-kampus" className={SECTION}>
      <Container>
        <SectionHeading
          id="angka-kampus"
          title={m.national_by_campus_title()}
          description={m.national_by_campus_lead()}
          className="view-rise mb-8"
        />
        <div className="mx-auto max-w-6xl">
          <Table caption={m.national_by_campus_caption()} className=" text-sm">
            <thead>
              <tr>
                <Th>{m.national_col_campus()}</Th>
                <Th numeric>{m.national_col_received()}</Th>
                <Th numeric>{m.national_col_issues()}</Th>
                <Th numeric>{m.national_col_merged()}</Th>
                <Th numeric>{m.national_col_demands()}</Th>
              </tr>
            </thead>
            <tbody>
              {campuses.map((campus) => (
                <tr key={campus.id}>
                  <th
                    scope="row"
                    className="border-line-subtle border-r border-b px-4 py-3 text-left font-semibold"
                  >
                    {campus.campusName}
                  </th>
                  <Td numeric>{countText(campus.received)}</Td>
                  <Td numeric>{countText(campus.issues)}</Td>
                  <Td numeric>{countText(campus.issueReports)}</Td>
                  <Td numeric>
                    {campus.demands === undefined
                      ? m.data_no_data()
                      : formatNumber(campus.demands)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      </Container>
    </section>
  )
}

type BarRow = {
  key: string
  label: string
  issues: Count
  issueReports: Count
  color: string
}

// CSS bars, no JS
function BarTable({
  title,
  head,
  rows,
  empty,
}: {
  title: string
  head: string
  rows: BarRow[]
  empty?: string
}) {
  const max = maxOf(rows.map((row) => row.issues))
  return (
    <div className="rounded-2xl border border-line-subtle bg-surface-raised p-5 sm:p-6">
      {rows.length === 0 && empty ? (
        <>
          <h3 className="font-bold text-lg">{title}</h3>
          <p className="mt-2 text-ink-soft">{empty}</p>
        </>
      ) : (
        // Caption names the card
        <Table caption={title} className=" text-sm">
          <thead>
            <tr>
              <Th>{head}</Th>
              <Th numeric>{m.data_col_issues()}</Th>
              <Th numeric>{m.national_col_reports()}</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.key}>
                <th
                  scope="row"
                  className="w-full border-line-subtle border-b px-3 py-2 text-left font-semibold"
                >
                  {row.label}
                  <span
                    aria-hidden="true"
                    className="mt-1.5 block h-1.5 overflow-hidden rounded-full"
                  >
                    <span
                      className="bar-grow block h-full"
                      style={
                        {
                          "--i": index,
                          width: barWidth(row.issues, max),
                          background: row.color,
                        } as CSSProperties
                      }
                    />
                  </span>
                </th>
                <Td numeric>{countText(row.issues)}</Td>
                <Td numeric>{countText(row.issueReports)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  )
}

function Spread({ view }: { view: NationalData }) {
  const statusColor = (id: GovernmentStatus) => {
    const step = PIPELINE.indexOf(id)
    return step === -1
      ? SIDE_STATUS_COLOR
      : (STATUS_RAMP[step] ?? SIDE_STATUS_COLOR)
  }
  return (
    <section aria-labelledby="sebaran" className={`bg-page ${FOLLOW_ON}`}>
      <Container>
        <SectionHeading
          id="sebaran"
          title={m.national_spread_title()}
          description={m.national_spread_lead()}
          className="view-rise mb-10"
        />
        <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-2">
          <BarTable
            title={m.data_category_title()}
            head={m.data_col_category()}
            rows={view.categories.map((row) => ({
              key: row.id,
              label: CATEGORY_SHORT_TEXT[row.id](),
              issues: row.issues,
              issueReports: row.issueReports,
              color: CATEGORY_COLOR[row.id],
            }))}
          />
          <BarTable
            title={m.data_status_title()}
            head={m.data_col_status()}
            rows={view.statuses.map((row) => ({
              key: row.id,
              label: GOVERNMENT_TEXT[row.id](),
              issues: row.issues,
              issueReports: row.issueReports,
              color: statusColor(row.id),
            }))}
          />
          <div className="lg:col-span-2">
            <BarTable
              title={m.national_province_title()}
              head={m.data_col_province()}
              empty={m.national_province_empty()}
              rows={view.provinces.map((row) => ({
                key: row.code,
                label: row.name,
                issues: row.issues,
                issueReports: row.issueReports,
                color: STATUS_RAMP[2],
              }))}
            />
          </div>
        </div>
        <p className="mx-auto mt-6 max-w-6xl text-ink-muted text-sm">
          {m.national_hidden_note({ max: HIDDEN_MAX })}
        </p>
      </Container>
    </section>
  )
}

function AboutNational({ view }: { view: NationalData }) {
  const computed = formatDateTime(new Date(view.computedAt))
  const items = [
    {
      term: m.data_about_source_label(),
      desc: m.national_about_source(),
    },
    { term: m.data_about_updated_label(), desc: `${computed} WIB` },
    {
      term: m.data_about_next_label(),
      desc: m.data_about_next({
        minutes: REFRESH_MINUTES,
        time: formatDateTime(new Date(view.nextAt)),
      }),
    },
    {
      term: m.data_about_method_label(),
      desc: m.national_about_method({
        minutes: REFRESH_MINUTES,
        max: HIDDEN_MAX,
      }),
    },
  ]
  return (
    <section aria-labelledby="tentang-data" id="metode" className={FOLLOW_ON}>
      <Container>
        <div className="mx-auto max-w-6xl">
          <h2
            id="tentang-data"
            className="font-bold font-heading text-[clamp(2rem,4.4vw,3rem)] text-ink leading-[1.1] [font-synthesis-weight:none]"
          >
            {m.data_about_title()}
          </h2>
          <dl className="mt-8 max-w-3xl border-ink border-t-2">
            {items.map((item) => (
              <div key={item.term} className="border-line-subtle border-b py-3">
                <dt className="font-semibold">{item.term}</dt>
                <dd className="mt-1 text-ink-soft leading-relaxed">
                  {item.desc}
                </dd>
              </div>
            ))}
          </dl>
          {/* One next step */}
          <p className="mt-12">
            <ButtonLink to="/tentang" size="lg">
              {m.national_about_link()}
            </ButtonLink>
          </p>
        </div>
      </Container>
    </section>
  )
}

/** Apex `/`, rendered without JS. */
export default function NationalPage({ view }: { view: NationalView }) {
  if (view.kind === "empty") {
    return (
      <>
        <PageHeader
          title={m.national_title()}
          description={m.national_lead()}
        />
        <Container width="3xl" className="pt-6 pb-20 text-center">
          <h2 className="font-bold text-2xl">{m.national_empty_title()}</h2>
          <p className="mt-3 text-ink-soft text-lg">
            {m.national_empty_body({ minutes: REFRESH_MINUTES })}
          </p>
          <p className="mt-10">
            <ButtonLink to="/tentang" size="lg">
              {m.national_about_link()}
            </ButtonLink>
          </p>
        </Container>
      </>
    )
  }
  return (
    <>
      <PageHeader title={m.national_title()} description={m.national_lead()}>
        <p className="mt-4 text-ink-muted text-sm">
          {m.national_updated({
            time: formatDateTime(new Date(view.computedAt)),
          })}
        </p>
      </PageHeader>
      {view.stale && (
        <Container width="3xl" className="pt-6">
          <Note>
            {m.data_stale({ time: formatDateTime(new Date(view.computedAt)) })}
          </Note>
        </Container>
      )}
      <Campuses campuses={view.campuses} />
      <KeyNumbers total={view.total} demands={view.demands} />
      <CampusTable campuses={view.campuses} />
      <Spread view={view} />
      <AboutNational view={view} />
    </>
  )
}
