import { Camera, FileText, Film, Image, Images, X } from "lucide-react"
import { type ChangeEvent, type DragEvent, useEffect, useState } from "react"
import { cn } from "~/components/ui/cn"
import { describedBy, ErrorMessage } from "~/components/ui/field"
import { m } from "~/paraglide/messages.js"
import { formatDuration, formatFileSize } from "../../../shared/format.ts"
import {
  EVIDENCE_LIMITS,
  evidenceKind,
  MAX_EVIDENCE_FILES,
  MAX_FULL_DECODE_PIXELS,
} from "../../../shared/report-fields.ts"
import type { EvidenceEntry } from "./draft"
import { memory } from "./draft-store"
import { focusById, focusIdAfterRemoval } from "./focus"

const MB = 1024 * 1024
// Review links land here
export const INPUT_ID = "evidence"
const CAMERA_ID = "evidence-camera"
// Unrestricted image list keeps HEIC
const ACCEPT = "image/*,application/pdf,video/*"

export const removeButtonId = (index: number) => `evidence-remove-${index}`

// Input focus shows on label
const PICK_BUTTON =
  "inline-flex cursor-pointer items-center justify-center gap-2 rounded-[10px] border-2 border-ink bg-surface-raised px-4 font-semibold text-ink transition-[background-color,color] hover:bg-ink hover:text-surface-raised peer-focus:outline-3 peer-focus:outline-focus peer-focus:outline-offset-3 peer-focus:outline-solid"

const ICON_TILE =
  "grid size-14 shrink-0 place-items-center bg-surface text-ink-muted"

// URL made after mount
function Preview({ file }: { file: File }) {
  const kind = evidenceKind(file)
  const [url, setUrl] = useState<string | null>(null)
  const [broken, setBroken] = useState(false)
  useEffect(() => {
    if (kind !== "image") return
    const made = URL.createObjectURL(file)
    setUrl(made)
    return () => URL.revokeObjectURL(made)
  }, [file, kind])
  if (kind === "pdf" || kind === "video") {
    const Icon = kind === "pdf" ? FileText : Film
    return (
      <span aria-hidden="true" className={ICON_TILE}>
        <Icon className="size-6" />
      </span>
    )
  }
  // HEIC renders in Safari only
  if (broken) {
    return (
      <span aria-hidden="true" className={ICON_TILE}>
        <Image className="size-6" />
      </span>
    )
  }
  return url ? (
    <img
      src={url}
      alt=""
      width={56}
      height={56}
      onError={() => setBroken(true)}
      className="size-14 shrink-0 object-cover"
    />
  ) : (
    <span aria-hidden="true" className="size-14 shrink-0 bg-surface" />
  )
}

const KIND_TEXT = {
  image: m.evidence_kind_image,
  pdf: m.evidence_kind_pdf,
  video: m.evidence_kind_video,
} as const

function fileMeta(file: File): string {
  const kind = evidenceKind(file)
  const seconds = memory.meta.get(file)?.durationSeconds
  const label =
    kind === "video" && seconds !== undefined
      ? m.evidence_video_meta({ duration: formatDuration(seconds * 1000) })
      : kind
        ? KIND_TEXT[kind]()
        : ""
  return label
    ? `${label} · ${formatFileSize(file.size)}`
    : formatFileSize(file.size)
}

type PickerProps = {
  files: File[]
  onChange: (files: File[]) => void
  missing: EvidenceEntry[]
  error?: string
}

// Files stay in this tab
export function EvidencePicker({
  files,
  onChange,
  missing,
  error,
}: PickerProps) {
  const [inputKey, setInputKey] = useState(0)
  const [removed, setRemoved] = useState("")
  const [dragging, setDragging] = useState(false)
  const [focusTarget, setFocusTarget] = useState<string | null>(null)
  const full = files.length >= MAX_EVIDENCE_FILES
  // Removed button took focus along
  useEffect(() => {
    if (!focusTarget) return
    focusById(document, focusTarget)
    setFocusTarget(null)
  }, [focusTarget])
  const remove = (index: number) => {
    setRemoved(m.evidence_removed({ name: files[index]?.name ?? "" }))
    setFocusTarget(
      focusIdAfterRemoval(index, files.length, removeButtonId, INPUT_ID),
    )
    onChange(files.filter((_, i) => i !== index))
  }
  const hint = m.evidence_hint({
    max: MAX_EVIDENCE_FILES,
    size: EVIDENCE_LIMITS.image / MB,
    videoSize: EVIDENCE_LIMITS.video / MB,
    megapixels: MAX_FULL_DECODE_PIXELS / 1_000_000,
  })
  const add = (event: ChangeEvent<HTMLInputElement>) => {
    const chosen = Array.from(event.currentTarget.files ?? [])
    onChange([...files, ...chosen])
    // Allow choosing same file again
    setInputKey((key) => key + 1)
  }
  // Type check runs on continue
  const drop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragging(false)
    if (full) return
    onChange([...files, ...Array.from(event.dataTransfer.files)])
  }
  const inputProps = {
    type: "file",
    name: "evidence",
    accept: ACCEPT,
    onChange: add,
    // Hash scroll shows whole dropzone
    className: "peer sr-only scroll-mt-28",
    "aria-describedby": describedBy(INPUT_ID, true, Boolean(error)),
    "aria-invalid": error ? true : undefined,
  } as const
  return (
    <div className="flex flex-col gap-6">
      <div
        className={cn(
          "flex flex-col gap-1.5",
          error && "border-l-4 border-danger pl-4",
        )}
      >
        <p
          id={`${INPUT_ID}-hint`}
          className="font-ui text-[0.95rem] text-ink-muted"
        >
          {hint}
        </p>
        {/* biome-ignore lint/a11y/noStaticElementInteractions: drop mirrors the inputs */}
        <div
          onDragOver={(event) => {
            event.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={drop}
          className={cn(
            "flex flex-col items-center gap-3 border-2 border-dashed px-4 py-8 text-center transition-colors pointer-coarse:py-5",
            dragging
              ? "border-brand bg-brand-soft"
              : "border-line bg-surface-raised",
          )}
        >
          {/* Full: summary link lands here */}
          <div
            id={full ? INPUT_ID : undefined}
            tabIndex={full ? -1 : undefined}
            className={full ? undefined : "pointer-coarse:hidden"}
          >
            <p className="font-semibold">
              {full ? m.evidence_drop_full() : m.evidence_drop()}
            </p>
            <p className="font-ui text-ink-muted text-sm">
              {full ? m.evidence_drop_full_hint() : m.evidence_drop_or()}
            </p>
          </div>
          {!full && (
            <div className="flex w-full flex-col items-center gap-3 pointer-coarse:items-stretch">
              <div className="hidden flex-col pointer-coarse:flex">
                <input
                  key={`camera-${inputKey}`}
                  id={CAMERA_ID}
                  capture="environment"
                  {...inputProps}
                />
                <label htmlFor={CAMERA_ID} className={`${PICK_BUTTON} h-12`}>
                  <Camera aria-hidden="true" className="size-5" />
                  {m.evidence_camera()}
                </label>
              </div>
              <div className="flex flex-col">
                <input key={inputKey} id={INPUT_ID} multiple {...inputProps} />
                <label
                  htmlFor={INPUT_ID}
                  className={`${PICK_BUTTON} h-9 text-sm pointer-coarse:h-12 pointer-coarse:text-base`}
                >
                  <Images
                    aria-hidden="true"
                    className="hidden size-5 pointer-coarse:block"
                  />
                  <span className="pointer-coarse:hidden">
                    {m.evidence_label()}
                  </span>
                  <span className="hidden pointer-coarse:inline">
                    {m.evidence_gallery()}
                  </span>
                </label>
              </div>
            </div>
          )}
        </div>
        {error && <ErrorMessage id={INPUT_ID}>{error}</ErrorMessage>}
      </div>
      {missing.length > 0 && (
        <ul className="flex flex-col gap-1 border-danger border-l-4 pl-4">
          {missing.map((entry) => (
            <li key={`${entry.name}-${entry.size}`}>
              {m.evidence_missing({ name: entry.name })}
            </li>
          ))}
        </ul>
      )}
      <section aria-labelledby="evidence-chosen">
        <h2 id="evidence-chosen" className="font-semibold">
          {m.evidence_chosen()}
        </h2>
        {files.length === 0 ? (
          <p className="mt-2 font-ui text-ink-muted">{m.evidence_none()}</p>
        ) : (
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {files.map((file, index) => (
              <li
                key={`${file.name}-${file.size}-${file.lastModified}`}
                className="flex items-center gap-3 border border-line-subtle bg-surface-raised p-2.5"
              >
                <Preview file={file} />
                <div className="min-w-0 flex-1">
                  <p
                    title={file.name}
                    className="truncate font-semibold text-sm"
                  >
                    {file.name}
                  </p>
                  <p className="font-ui text-ink-muted text-xs">
                    {fileMeta(file)}
                  </p>
                </div>
                <button
                  id={removeButtonId(index)}
                  type="button"
                  aria-label={m.evidence_remove_name({ name: file.name })}
                  onClick={() => remove(index)}
                  className="grid size-9 shrink-0 cursor-pointer place-items-center rounded-md text-ink-muted transition-colors hover:bg-danger hover:text-on-accent"
                >
                  <X aria-hidden="true" className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <p role="status" className="sr-only">
          {removed}
        </p>
      </section>
    </div>
  )
}
