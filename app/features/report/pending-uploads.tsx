import { type ChangeEvent, useState } from "react"
import { useRevalidator } from "react-router"
import { m } from "~/paraglide/messages.js"
import { formatDateTime, formatFileSize } from "../../../shared/format.ts"
import {
  type EvidenceKind,
  evidenceKind,
} from "../../../shared/report-fields.ts"
import { uploadFiles } from "./evidence-upload"
import type { PendingUpload } from "./tracking.server"

const ACCEPT: Record<EvidenceKind, string> = {
  image: "image/*",
  pdf: "application/pdf",
  video: "video/*",
}

const KIND_TEXT: Record<EvidenceKind, () => string> = {
  image: m.evidence_kind_image,
  pdf: m.evidence_kind_pdf,
  video: m.evidence_kind_video,
}

const PICK =
  "inline-flex h-9 cursor-pointer items-center rounded-[10px] border-2 border-ink bg-surface-raised px-4 font-semibold text-ink text-sm transition-[background-color,color] hover:bg-ink hover:text-surface-raised peer-focus:outline-3 peer-focus:outline-focus peer-focus:outline-offset-3 peer-focus:outline-solid"

type RowState =
  | { kind: "idle" }
  | { kind: "sending"; percent: number }
  | { kind: "done" }
  | { kind: "error"; text: string }

function PendingRow({ item }: { item: PendingUpload }) {
  const [state, setState] = useState<RowState>({ kind: "idle" })
  const revalidator = useRevalidator()
  const inputId = `kirim-${item.id}`
  const send = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ""
    if (!file) return
    // Same kind, never larger
    if (evidenceKind(file) !== item.kind || file.size > item.size) {
      setState({
        kind: "error",
        text: m.track_upload_wrong({
          kind: KIND_TEXT[item.kind]().toLowerCase(),
          size: formatFileSize(item.size),
        }),
      })
      return
    }
    setState({ kind: "sending", percent: 0 })
    const { failed } = await uploadFiles([{ id: item.id, file }], {
      onProgress: (_, fraction) =>
        setState({ kind: "sending", percent: Math.round(fraction * 100) }),
    })
    if (failed.length > 0) {
      setState({
        kind: "error",
        text: m.track_upload_failed({ name: item.name }),
      })
      return
    }
    setState({ kind: "done" })
    await revalidator.revalidate()
  }
  return (
    <li className="flex flex-col gap-2 border-ink/15 border-b py-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="min-w-0 break-all">
        <span className="font-semibold">
          {m.manage_evidence_item({ position: item.position + 1 })}
        </span>{" "}
        {item.name}
      </p>
      <div className="flex flex-col items-start gap-1 sm:items-end">
        {state.kind === "done" ? null : (
          <div className="flex flex-col">
            <input
              id={inputId}
              type="file"
              accept={ACCEPT[item.kind]}
              onChange={send}
              disabled={state.kind === "sending"}
              className="peer sr-only"
            />
            <label htmlFor={inputId} className={PICK}>
              {m.track_upload_choose({ name: item.name })}
            </label>
          </div>
        )}
        <p role="status" className="font-ui text-sm">
          {state.kind === "sending"
            ? m.upload_progress({
                current: 1,
                total: 1,
                percent: state.percent,
              })
            : state.kind === "done"
              ? m.track_upload_done({ name: item.name })
              : state.kind === "error"
                ? state.text
                : ""}
        </p>
      </div>
    </li>
  )
}

type Props = {
  items: PendingUpload[]
  until: Date
  canUpload: boolean
  titleId: string
  reportTitleId?: string
}

/** PLAN §7: send later. */
export function PendingUploads({
  items,
  until,
  canUpload,
  titleId,
  reportTitleId,
}: Props) {
  return (
    <section
      // Unique name per report card
      aria-labelledby={reportTitleId ? `${titleId} ${reportTitleId}` : titleId}
      className="mt-6 border-ink border-t-2 pt-4"
    >
      <h3 id={titleId} className="font-bold text-lg">
        {m.track_upload_title()}
      </h3>
      {canUpload ? (
        <>
          <p className="mt-1 font-ui text-[0.95rem] text-ink-soft">
            {m.track_upload_body({ deadline: formatDateTime(until) })}
          </p>
          <noscript>
            <p className="mt-2 text-sm">{m.track_upload_noscript()}</p>
          </noscript>
          <ul className="mt-2">
            {items.map((item) => (
              <PendingRow key={item.id} item={item} />
            ))}
          </ul>
        </>
      ) : (
        <p className="mt-1">
          {m.track_upload_sign_in()}{" "}
          <a
            href="/masuk?kembali=%2Flacak"
            className="font-semibold text-accent underline underline-offset-4 hover:no-underline"
          >
            {m.signin_page_title()}
          </a>
        </p>
      )}
    </section>
  )
}
