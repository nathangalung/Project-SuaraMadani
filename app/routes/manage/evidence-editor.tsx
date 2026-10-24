import { ChevronLeft } from "lucide-react"
import { data, Link, redirect } from "react-router"
import { Note } from "~/components/ui/note"
import { requireAdmin } from "~/features/moderation/access.server"
import {
  decideEvidence,
  getEvidenceEditor,
} from "~/features/moderation/evidence.server"
import {
  type EditorError,
  EvidenceDecisionForm,
} from "~/features/moderation/evidence-editor"
import {
  EVIDENCE_STATUS_TEXT,
  FAILURE_TEXT,
} from "~/features/moderation/report-details"
import { useSubmitting } from "~/features/moderation/submitting"
import { useSiteTitle } from "~/features/report/page-title"
import { m } from "~/paraglide/messages.js"
import type { Route } from "./+types/evidence-editor"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const { tenant, role } = await requireAdmin(context)
  const view = UUID.test(params.id)
    ? await getEvidenceEditor(tenant.id, role, params.id)
    : null
  if (!view) throw data(null, { status: 404 })
  const saved = new URL(request.url).searchParams.has("tersimpan")
  return { view, saved }
}

type ActionData = { errors: EditorError[] } | { conflict: true }

function readBoxes(form: FormData): unknown {
  try {
    return JSON.parse(String(form.get("boxes") ?? "[]"))
  } catch {
    return null
  }
}

export async function action({ request, params, context }: Route.ActionArgs) {
  const { tenant, session } = await requireAdmin(context)
  if (!UUID.test(params.id)) throw data(null, { status: 404 })
  const form = await request.formData()
  if (form.get("intent") !== "decide") throw data(null, { status: 400 })
  const seen = String(form.get("seen") ?? "")
  const result = await decideEvidence(tenant.id, {
    evidenceId: params.id,
    actorId: session.user.id,
    seen: seen === "" ? null : seen,
    input: {
      decision: form.get("decision"),
      boxes: readBoxes(form),
      pages: form.has("pagesSent")
        ? form.getAll("pages").map((page) => Number(page))
        : undefined,
    },
  })
  if (result.ok) {
    throw redirect(`/kelola/bukti/${params.id}/sunting?tersimpan`, 303)
  }
  switch (result.reason) {
    case "not_found":
      throw data(null, { status: 404 })
    case "not_ready":
    case "changed":
      return data<ActionData>({ conflict: true }, { status: 409 })
    case "boxes_required":
    case "boxes_not_allowed":
    case "pages_required":
      return data<ActionData>({ errors: [result.reason] }, { status: 400 })
    default:
      return data<ActionData>({ errors: ["decision"] }, { status: 400 })
  }
}

const LINK = "font-semibold text-accent underline underline-offset-4"
const NO_ORIGINAL = new Set(["awaiting_upload", "missing", "rejected_malware"])

export default function EvidenceEditor({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { view, saved } = loaderData
  const position = view.position + 1
  const title = m.manage_evidence_editor_title({ position })
  const pending = useSubmitting("decide")
  const conflict = Boolean(actionData && "conflict" in actionData)
  const errors = actionData && "errors" in actionData ? actionData.errors : []
  const issueNote = !view.issue
    ? m.manage_evidence_when_unmerged()
    : view.issue.published
      ? m.manage_evidence_when_published({ code: view.issue.code })
      : m.manage_evidence_when_unpublished({ code: view.issue.code })
  return (
    <div className="flex flex-col gap-6">
      <title>{useSiteTitle(title)}</title>
      <Link
        to={`/kelola/laporan/${view.reportCode}#bukti-${view.id}`}
        className="inline-flex items-center gap-1 self-start font-semibold text-ink text-sm underline-offset-4 hover:underline"
      >
        <ChevronLeft aria-hidden="true" className="size-4" />
        {m.manage_evidence_back({ code: view.reportCode })}
      </Link>
      <h1 className="font-bold font-heading text-3xl [font-synthesis-weight:none]">
        {title}
      </h1>
      {conflict ? (
        <Note tone="danger">
          <p role="alert">{m.manage_evidence_changed()}</p>
        </Note>
      ) : null}
      {saved && !conflict ? (
        <Note tone="success">
          <p role="status">{m.manage_evidence_saved()}</p>
        </Note>
      ) : null}
      {view.status === "published" ? (
        <PublishedView view={view} position={position} />
      ) : view.status === "ready" ? (
        <>
          <Note tone="info">
            <p>{m.manage_evidence_guide()}</p>
            <p className="mt-1">{issueNote}</p>
          </Note>
          <EvidenceDecisionForm
            key={view.seen ?? "baru"}
            evidenceId={view.id}
            reportCode={view.reportCode}
            position={view.position}
            kind={view.kind}
            pages={view.previewPages}
            boxes={view.boxes}
            publishPages={view.pages}
            decision={view.decision}
            seen={view.seen}
            errors={errors}
            pending={pending}
          />
        </>
      ) : (
        <Note>
          <p>
            {m.manage_evidence_not_ready({
              status: EVIDENCE_STATUS_TEXT[view.status](),
            })}
          </p>
          {view.failureReason ? (
            <p className="mt-1">
              {m.manage_evidence_failure({
                reason: FAILURE_TEXT[view.failureReason](),
              })}
            </p>
          ) : null}
        </Note>
      )}
      {NO_ORIGINAL.has(view.status) ? null : (
        <p className="text-[0.95rem] text-ink-soft">
          <a href={`/kelola/bukti/${view.id}/asli`} download className={LINK}>
            {m.manage_evidence_download()}
          </a>{" "}
          {m.manage_evidence_download_hint()}
        </p>
      )}
    </div>
  )
}

type ViewProps = {
  view: Route.ComponentProps["loaderData"]["view"]
  position: number
}

// Public copies, read only
function PublishedView({ view, position }: ViewProps) {
  return (
    <section aria-labelledby="salinan-publik" className="flex flex-col gap-4">
      <Note>
        <p>{m.manage_evidence_published_note()}</p>
      </Note>
      <h2 id="salinan-publik" className="font-bold text-2xl">
        {m.manage_evidence_public_title()}
      </h2>
      <ul className="grid gap-4 sm:grid-cols-2">
        {(view.publicMedia ?? []).map((media) => (
          <li key={media.file}>
            {media.type === "image" ? (
              <img
                src={`/media/${media.file}`}
                alt={m.manage_evidence_page_alt({
                  page: media.page + 1,
                  position,
                })}
                width={media.width}
                height={media.height}
                loading="lazy"
                className="h-auto w-full border border-line-subtle bg-surface"
              />
            ) : (
              <img
                src={`/media/${media.poster}`}
                alt={m.manage_evidence_video_label({ position })}
                width={media.width}
                height={media.height}
                loading="lazy"
                className="h-auto w-full border border-line-subtle bg-surface"
              />
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
