import { ExternalLink } from "lucide-react"
import { data, Link, useSearchParams } from "react-router"
import { Badge } from "~/components/ui/badge"
import { errorTitle } from "~/components/ui/error-summary"
import { Note } from "~/components/ui/note"
import { demandEditorAction } from "~/features/demands/actions.server"
import { CATEGORY_TEXT } from "~/features/demands/category-labels"
import {
  AddItemForm,
  DemandFieldsForm,
  DraftPreview,
  demandErrors,
  EditorNote,
  type EditorNotice,
  IssueLinks,
  ItemEditor,
  type ItemSpot,
  panelOf,
  StateForms,
} from "~/features/demands/editor-forms"
import { demandPlace, STATE_TEXT } from "~/features/demands/labels"
import {
  demandProgress,
  getManagedDemand,
} from "~/features/demands/manage.server"
import { NeutralNotice } from "~/features/demands/neutral-notice"
import { FulfilmentMark } from "~/features/demands/status-mark"
import { requireAdmin } from "~/features/moderation/access.server"
import { ActionPanel } from "~/features/moderation/action-panel"
import { ReviewNotices } from "~/features/moderation/review-forms"
import { useSiteTitle } from "~/features/report/page-title"
import { regencyGroups } from "~/features/report/regions.server"
import { m } from "~/paraglide/messages.js"
import {
  normalizeDemandCode,
  RANKING_ACCOUNT_DAYS,
  RANKING_MIN_RANKERS,
} from "../../../shared/demands.ts"
import { formatDate, jakartaIsoDate } from "../../../shared/format.ts"
import { neutralFindings } from "../../../shared/neutral-language.ts"
import type { Route } from "./+types/demand"

export async function loader({ params, context }: Route.LoaderArgs) {
  const { tenant } = await requireAdmin(context)
  const code = normalizeDemandCode(params.code)
  const demand = code ? await getManagedDemand(tenant.id, code) : null
  if (!demand) throw data(null, { status: 404 })
  const [regencies] = await Promise.all([regencyGroups()])
  const province = regencies.find((group) => group.code === demand.provinceCode)
  return {
    demand,
    regencies,
    place: demandPlace({
      scope: demand.scope,
      provinceName: province?.name ?? null,
      regencyName:
        province?.regencies.find((r) => r.code === demand.regencyCode)?.name ??
        null,
    }),
    today: jakartaIsoDate(new Date()),
    progress: demandProgress(demand.items.map((item) => item.state)),
    // Public text, staff advice
    neutral: neutralFindings(
      [
        demand.title,
        demand.summary,
        demand.body,
        demand.target,
        ...demand.items.flatMap((item) => [item.body, item.briefSummary ?? ""]),
      ].join("\n"),
    ),
  }
}

export const action = demandEditorAction

// Editor prefill, no item list
function fieldsOf(demand: Route.ComponentProps["loaderData"]["demand"]) {
  const { scope, provinceCode, regencyCode, title, body, summary } = demand
  return {
    scope,
    provinceCode,
    regencyCode,
    category: demand.category,
    title,
    body,
    summary,
    target: demand.target,
    raisedOn: demand.raisedOn,
    briefUrl: demand.briefUrl,
  }
}

const SECTION = "mt-12 border-ink border-t-2 pt-6"
const H2 = "font-bold text-2xl"

const SAVED_TEXT: Record<string, () => string> = {
  edit: m.demand_saved_edit,
  publish: m.demand_saved_publish,
  close: m.demand_saved_close,
  reopen: m.demand_saved_reopen,
  add_item: m.demand_saved_add_item,
  edit_item: m.demand_saved_edit_item,
  move_up: m.demand_saved_move,
  move_down: m.demand_saved_move,
  remove_item: m.demand_saved_remove_item,
  update_item: m.demand_saved_update_item,
  edit_brief: m.demand_saved_edit_brief,
  publish_brief: m.demand_saved_publish_brief,
  withdraw_brief: m.demand_saved_withdraw_brief,
  link_issue: m.demand_saved_link_issue,
  unlink_issue: m.demand_saved_unlink_issue,
}

type Place = "state" | "items" | "add" | "details" | "issues" | "item"

// Item intents: their item
const PLACE: Partial<Record<string, Place>> = {
  edit: "details",
  publish: "state",
  close: "state",
  reopen: "state",
  add_item: "add",
  remove_item: "items",
  link_issue: "issues",
  unlink_issue: "issues",
}

type Placed = EditorNotice & { place: Place; spot: ItemSpot; itemId?: string }

/** Notice placed where saved. */
function placedNotice(
  actionData: Route.ComponentProps["actionData"],
): Placed | null {
  if (!actionData) return null
  if ("saved" in actionData) {
    const intent = actionData.saved
    return {
      tone: "success",
      text: (SAVED_TEXT[intent] ?? m.demand_saved_edit)(),
      place: PLACE[intent] ?? "item",
      spot: panelOf(intent) ?? "head",
      itemId: actionData.itemId,
    }
  }
  if (!("unchanged" in actionData)) return null
  return {
    tone: "info",
    text: m.demand_unchanged(),
    place: PLACE[actionData.intent] ?? "item",
    spot: panelOf(actionData.intent) ?? "head",
    itemId: actionData.itemId,
  }
}

const UPLOAD_TEXT: Record<
  string,
  { tone: "success" | "danger"; text: () => string }
> = {
  diunggah: { tone: "success", text: m.demand_upload_done },
  kosong: { tone: "danger", text: m.demand_error_brief_file },
  besar: { tone: "danger", text: m.demand_upload_too_large },
  "bukan-pdf": { tone: "danger", text: m.demand_upload_not_pdf },
  ditutup: { tone: "danger", text: m.demand_error_closed },
}

export default function ManageDemand({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { demand, regencies, today } = loaderData
  const [params] = useSearchParams()
  const failed = actionData && "errors" in actionData ? actionData : undefined
  const errors = failed ? demandErrors(failed.errors, failed.itemId) : []
  const conflict = Boolean(actionData && "conflict" in actionData)
  const placed = placedNotice(actionData)
  const at = (place: Place) => (placed?.place === place ? placed : null)
  const uploadText = UPLOAD_TEXT[params.get("dokumen") ?? ""]
  const upload = uploadText
    ? { tone: uploadText.tone, text: uploadText.text() }
    : null
  // Upload redirect names its item
  const uploadItem = demand.items.some((i) => i.id === params.get("butir"))
    ? params.get("butir")
    : null
  const itemNotice = (id: string) => {
    if (placed?.place === "item" && placed.itemId === id) {
      return { notice: placed, at: placed.spot }
    }
    return upload && uploadItem === id
      ? { notice: upload, at: "brief" as const }
      : null
  }
  const title = m.manage_demand_page_title({ code: demand.code })
  const pageTitle = useSiteTitle(title)
  const { progress } = loaderData
  const fieldsFailed = failed?.intent === "edit"
  return (
    <div>
      <title>{errorTitle(pageTitle, errors.length > 0 || conflict)}</title>
      <ReviewNotices conflict={conflict} errors={errors} attempt={actionData} />
      {/* New page, top visible */}
      {params.get("dibuat") ? (
        <Note tone="success" className="mb-6">
          <p role="status">{m.demand_created()}</p>
        </Note>
      ) : null}
      {uploadItem ? null : <EditorNote notice={upload} className="mb-6" />}
      <h1 className="font-bold font-heading text-3xl [font-synthesis-weight:none]">
        {title}
      </h1>
      <p className="mt-3 flex flex-wrap items-center gap-2">
        <Badge tone={demand.state === "published" ? "soft" : "neutral"}>
          {STATE_TEXT[demand.state]()}
        </Badge>
        <Badge tone="subtle">{loaderData.place}</Badge>
        {demand.category ? (
          <Badge tone="subtle">{CATEGORY_TEXT[demand.category]()}</Badge>
        ) : null}
        {demand.publishedAt ? (
          <span className="text-ink-muted text-sm">
            {m.demand_published_on({ date: formatDate(demand.publishedAt) })}
          </span>
        ) : null}
      </p>
      <h2 className="mt-6 font-bold text-2xl">{demand.title}</h2>
      <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
        <FulfilmentMark status={progress.status} />
        <span className="text-sm">
          {m.demand_progress_line({
            done: progress.fulfilled,
            total: progress.total,
          })}
        </span>
      </p>
      {demand.state !== "draft" ? (
        <p className="mt-2 text-ink-soft text-sm">
          {!demand.ranking.shown
            ? m.demand_rank_admin_few({
                total: demand.ranking.rankers,
                min: RANKING_MIN_RANKERS,
              })
            : m.demand_rank_admin({
                place: demand.rank.place ?? "–",
                rankers: demand.rank.rankers,
                total: demand.ranking.rankers,
              })}{" "}
          {demand.pendingRankers > 0
            ? m.demand_rank_admin_pending({
                count: demand.pendingRankers,
                days: RANKING_ACCOUNT_DAYS,
              })
            : null}
        </p>
      ) : null}
      <NeutralNotice findings={loaderData.neutral} className="mt-5" />
      {demand.hiddenAt ? (
        <Note tone="danger" className="mt-5">
          {m.demand_hidden_note({ date: formatDate(demand.hiddenAt) })}
        </Note>
      ) : null}
      {demand.state !== "draft" ? (
        <p className="mt-4">
          <Link
            to={`/tuntutan/${demand.code}`}
            className="inline-flex items-center gap-1.5 font-semibold text-accent underline underline-offset-4"
          >
            {m.manage_view_public()}
            <ExternalLink aria-hidden="true" className="size-4" />
          </Link>
        </p>
      ) : null}

      <section aria-labelledby="demand-state" className={SECTION}>
        <h2 id="demand-state" className={`mb-4 ${H2}`}>
          {m.demand_state_title()}
        </h2>
        {demand.state === "draft" ? (
          <div className="mb-4">
            <DraftPreview demand={demand} />
          </div>
        ) : null}
        <StateForms demand={demand} errors={errors} />
        <EditorNote notice={at("state")} className="mt-4" />
      </section>

      <section
        id="sub-tuntutan"
        aria-labelledby="demand-items"
        className={SECTION}
      >
        <h2 id="demand-items" className={H2}>
          {m.demand_items_title()}
        </h2>
        <p className="mt-1 mb-5 text-[0.95rem] text-ink-soft">
          {m.demand_items_admin_lead()}
        </p>
        {demand.items.length > 0 ? (
          <ol className="flex flex-col gap-5">
            {demand.items.map((item, index) => (
              <ItemEditor
                key={item.id}
                demand={demand}
                item={item}
                index={index}
                errors={failed?.itemId === item.id ? errors : []}
                today={today}
                open={
                  failed?.itemId === item.id ? panelOf(failed.intent) : null
                }
                values={failed?.itemId === item.id ? failed.values : undefined}
                notice={itemNotice(item.id)}
              />
            ))}
          </ol>
        ) : (
          <p className="text-ink-muted">{m.demand_items_empty()}</p>
        )}
        <EditorNote notice={at("items")} className="mt-5" />
        {demand.frozen ? null : (
          <div className="mt-6">
            <ActionPanel
              id="tambah"
              title={m.demand_item_add()}
              open={failed?.intent === "add_item" || Boolean(at("add"))}
            >
              {/* Added: empty field, no repeat */}
              <AddItemForm
                key={demand.items.length}
                errors={failed?.intent === "add_item" ? errors : []}
                values={
                  failed?.intent === "add_item" ? failed.values : undefined
                }
              />
              <EditorNote notice={at("add")} className="mt-5" />
            </ActionPanel>
          </div>
        )}
      </section>

      <section aria-labelledby="demand-details" className={SECTION}>
        <h2 id="demand-details" className={`mb-4 ${H2}`}>
          {m.demand_details_title()}
        </h2>
        <ActionPanel
          id="rincian"
          title={m.demand_edit_title()}
          open={fieldsFailed || Boolean(at("details"))}
        >
          <DemandFieldsForm
            values={
              fieldsFailed && failed?.values ? failed.values : fieldsOf(demand)
            }
            regencies={regencies}
            errors={fieldsFailed ? errors : []}
            intent="edit"
            version={demand.version}
          />
          <EditorNote notice={at("details")} className="mt-5" />
        </ActionPanel>
      </section>

      <section aria-labelledby="demand-issues" className={SECTION}>
        <h2 id="demand-issues" className={H2}>
          {m.demand_issues_title()}
        </h2>
        <p className="mt-1 mb-5 text-[0.95rem] text-ink-soft">
          {m.demand_issues_admin_lead()}
        </p>
        <IssueLinks
          demand={demand}
          errors={
            failed?.intent === "link_issue" || failed?.intent === "unlink_issue"
              ? errors
              : []
          }
        />
        <EditorNote notice={at("issues")} className="mt-5" />
      </section>
    </div>
  )
}
