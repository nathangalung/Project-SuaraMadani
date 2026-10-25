import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useId,
  useRef,
  useState,
} from "react"
import { Form } from "react-router"
import { Button } from "~/components/ui/button"
import { cn } from "~/components/ui/cn"
import { Checkbox, ErrorMessage, Fieldset, Radio } from "~/components/ui/field"
import { m } from "~/paraglide/messages.js"
import type {
  EvidenceDecision,
  RedactionBox,
  RedactionStyle,
} from "../../../shared/evidence.ts"
import {
  boxPercent,
  centeredBox,
  isNudgeKey,
  nudgeBox,
  rectFromDrag,
} from "./redaction"

export type EditorError =
  | "boxes_required"
  | "boxes_not_allowed"
  | "pages_required"
  | "decision"

const EDITOR_ERROR_TEXT: Record<EditorError, () => string> = {
  boxes_required: m.manage_evidence_error_boxes_required,
  boxes_not_allowed: m.manage_evidence_error_boxes_not_allowed,
  pages_required: m.manage_evidence_error_pages_required,
  decision: m.manage_evidence_error_decision,
}

const STYLE_TEXT: Record<RedactionStyle, () => string> = {
  fill: m.manage_evidence_style_fill,
  pixelate: m.manage_evidence_style_pixelate,
}

const DECISION_FIELD = "keputusan"
const PAGES_FIELD = "halaman"

type Point = { x: number; y: number }

function pointIn(event: PointerEvent<HTMLElement>, el: HTMLElement): Point {
  const rect = el.getBoundingClientRect()
  return { x: event.clientX - rect.left, y: event.clientY - rect.top }
}

type CanvasProps = {
  src: string
  alt: string
  page: number
  boxes: RedactionBox[]
  newStyle: RedactionStyle
  hintId: string
  onAdd: (box: RedactionBox) => void
  onChange: (index: number, box: RedactionBox) => void
  onRemove: (index: number) => void
}

// Boxes in percent, image scales
function PageCanvas(props: CanvasProps) {
  const surface = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<{ start: Point; end: Point } | null>(null)
  const draft =
    drag && surface.current
      ? rectFromDrag(drag.start, drag.end, {
          width: surface.current.clientWidth,
          height: surface.current.clientHeight,
        })
      : null
  const start = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || event.target !== event.currentTarget) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const at = pointIn(event, event.currentTarget)
    setDrag({ start: at, end: at })
  }
  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag) return
    setDrag({ ...drag, end: pointIn(event, event.currentTarget) })
  }
  const end = () => {
    if (draft)
      props.onAdd({ page: props.page, ...draft, style: props.newStyle })
    setDrag(null)
  }
  const keys = (index: number, box: RedactionBox) => (event: KeyboardEvent) => {
    if (isNudgeKey(event.key)) {
      event.preventDefault()
      props.onChange(index, nudgeBox(box, event.key, event.shiftKey))
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault()
      props.onRemove(index)
    }
  }
  return (
    <div className="relative border border-line-subtle bg-surface">
      <img
        src={props.src}
        alt={props.alt}
        draggable={false}
        className="block w-full select-none"
      />
      <div
        ref={surface}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={() => setDrag(null)}
        className="absolute inset-0 cursor-crosshair touch-none select-none"
      >
        {props.boxes.map((box, index) => (
          <button
            // Order is the identity
            // biome-ignore lint/suspicious/noArrayIndexKey: boxes have no id
            key={index}
            type="button"
            aria-label={m.manage_evidence_box_label({
              n: index + 1,
              style: STYLE_TEXT[box.style](),
            })}
            aria-describedby={props.hintId}
            onKeyDown={keys(index, box)}
            style={boxPercent(box)}
            className={cn(
              "absolute cursor-default focus-visible:outline-3 focus-visible:outline-focus focus-visible:outline-offset-2",
              box.style === "fill"
                ? "bg-black"
                : "border-2 border-surface-raised border-dashed bg-ink/55",
            )}
          />
        ))}
        {draft ? (
          <span
            aria-hidden="true"
            style={boxPercent(draft)}
            className="absolute border-2 border-brand bg-brand/25"
          />
        ) : null}
      </div>
    </div>
  )
}

type BoxListProps = {
  boxes: RedactionBox[]
  onChange: (index: number, box: RedactionBox) => void
  onRemove: (index: number) => void
}

function BoxList({ boxes, onChange, onRemove }: BoxListProps) {
  if (boxes.length === 0) {
    return (
      <p className="text-ink-muted text-sm">{m.manage_evidence_no_boxes()}</p>
    )
  }
  return (
    <ol className="border-ink border-t-2">
      {boxes.map((box, index) => (
        <li
          // biome-ignore lint/suspicious/noArrayIndexKey: boxes have no id
          key={index}
          className="flex flex-wrap items-center gap-3 border-line-subtle border-b py-2"
        >
          <span className="min-w-20 font-semibold">
            {m.manage_evidence_box({ n: index + 1 })}
          </span>
          <select
            aria-label={m.manage_evidence_style_label({ n: index + 1 })}
            value={box.style}
            onChange={(event) =>
              onChange(index, {
                ...box,
                style: event.currentTarget.value as RedactionStyle,
              })
            }
            className="select-ui h-9 rounded-md border border-line bg-surface-raised px-2 text-sm"
          >
            <option value="fill">{m.manage_evidence_style_fill()}</option>
            <option value="pixelate">
              {m.manage_evidence_style_pixelate()}
            </option>
          </select>
          <Button variant="quiet" size="sm" onClick={() => onRemove(index)}>
            {m.manage_evidence_remove_box({ n: index + 1 })}
          </Button>
        </li>
      ))}
    </ol>
  )
}

type DecisionProps = {
  allowed: EvidenceDecision[]
  value: EvidenceDecision | null
  onChange: (value: EvidenceDecision) => void
  error?: string
  children?: ReactNode
}

const DECISION_TEXT: Record<
  EvidenceDecision,
  { label: () => string; hint: () => string }
> = {
  redact: {
    label: m.manage_evidence_decision_redact,
    hint: m.manage_evidence_decision_redact_hint,
  },
  no_redaction: {
    label: m.manage_evidence_decision_no_redaction,
    hint: m.manage_evidence_decision_no_redaction_hint,
  },
  withhold: {
    label: m.manage_evidence_decision_withhold,
    hint: m.manage_evidence_decision_withhold_hint,
  },
}

function DecisionField({ allowed, value, onChange, error }: DecisionProps) {
  return (
    <Fieldset
      id={DECISION_FIELD}
      legend={m.manage_evidence_decision_legend()}
      error={error}
    >
      {allowed.map((decision) => (
        <Radio
          key={decision}
          id={`${DECISION_FIELD}-${decision}`}
          name="decision"
          value={decision}
          checked={value === decision}
          onChange={() => onChange(decision)}
          label={DECISION_TEXT[decision].label()}
          hint={DECISION_TEXT[decision].hint()}
        />
      ))}
    </Fieldset>
  )
}

type FormProps = {
  evidenceId: string
  reportCode: string
  position: number
  kind: "image" | "pdf" | "video"
  pages: number
  boxes: RedactionBox[]
  publishPages: number[] | null
  decision: EvidenceDecision | null
  seen: string | null
  errors: EditorError[]
  pending: boolean
}

function firstError(
  errors: EditorError[],
  keys: EditorError[],
): string | undefined {
  const found = errors.find((error) => keys.includes(error))
  return found ? EDITOR_ERROR_TEXT[found]() : undefined
}

/** Client checks mirror parseDecision. */
function check(
  kind: FormProps["kind"],
  decision: EvidenceDecision | null,
  boxes: RedactionBox[],
  pages: number[],
): EditorError[] {
  if (!decision) return ["decision"]
  if (decision === "withhold") return []
  if (kind === "pdf" && pages.length === 0) return ["pages_required"]
  if (decision === "redact" && boxes.length === 0) return ["boxes_required"]
  if (decision === "no_redaction" && boxes.length > 0) {
    return ["boxes_not_allowed"]
  }
  return []
}

export function EvidenceDecisionForm(props: FormProps) {
  const hintId = useId()
  const [boxes, setBoxes] = useState(props.boxes)
  const [decision, setDecision] = useState(props.decision)
  const [newStyle, setNewStyle] = useState<RedactionStyle>("fill")
  const all = Array.from({ length: props.pages }, (_, i) => i)
  const [pages, setPages] = useState<number[]>(props.publishPages ?? all)
  const [clientErrors, setClientErrors] = useState<EditorError[] | null>(null)
  const errors = clientErrors ?? props.errors
  const base = `/kelola/bukti/${props.evidenceId}`
  const pagesError =
    props.kind === "pdf" ? firstError(errors, ["pages_required"]) : undefined
  const position = props.position + 1

  const add = (box: RedactionBox) => {
    setBoxes((list) => [...list, box])
    if (decision !== "withhold") setDecision("redact")
  }
  const change = (page: number) => (index: number, box: RedactionBox) =>
    setBoxes((list) => {
      const own = list.filter((b) => b.page === page)
      const target = own[index]
      return list.map((b) => (b === target ? box : b))
    })
  const remove = (page: number) => (index: number) =>
    setBoxes((list) => {
      const target = list.filter((b) => b.page === page)[index]
      return list.filter((b) => b !== target)
    })
  const publishedBoxes = boxes.filter(
    (box) => props.kind !== "pdf" || pages.includes(box.page),
  )
  const decisions: EvidenceDecision[] =
    props.kind === "video"
      ? ["no_redaction", "withhold"]
      : ["redact", "no_redaction", "withhold"]

  return (
    <Form
      method="post"
      noValidate
      onSubmit={(event) => {
        const found = check(props.kind, decision, publishedBoxes, pages)
        setClientErrors(found)
        if (found.length > 0) event.preventDefault()
      }}
      className="flex flex-col gap-8"
    >
      <input type="hidden" name="intent" value="decide" />
      <input type="hidden" name="seen" value={props.seen ?? ""} />
      {props.kind === "video" ? (
        <>
          {/* biome-ignore lint/a11y/useMediaCaption: evidence has no captions */}
          <video
            controls
            preload="metadata"
            playsInline
            poster={`${base}/0.webp`}
            src={`${base}/video.mp4`}
            aria-label={m.manage_evidence_video_label({ position })}
            className="w-full border border-line-subtle bg-ink"
          />
          <p className="text-[0.95rem] text-ink-soft">
            {m.manage_evidence_video_hint()}
          </p>
        </>
      ) : (
        <>
          <input
            type="hidden"
            name="boxes"
            value={JSON.stringify(publishedBoxes)}
          />
          {props.kind === "pdf" ? (
            <input type="hidden" name="pagesSent" value="1" />
          ) : null}
          <noscript>
            <p className="text-ink-soft text-sm">
              {m.manage_evidence_noscript()}
            </p>
          </noscript>
          <p id={hintId} className="text-[0.95rem] text-ink-soft">
            {m.manage_evidence_draw_hint()}
          </p>
          <fieldset className="flex flex-wrap items-center gap-x-5 gap-y-1">
            <legend className="mb-1 font-semibold">
              {m.manage_evidence_new_style()}
            </legend>
            {(["fill", "pixelate"] as const).map((style) => (
              <Radio
                key={style}
                inline
                id={`gaya-${style}`}
                name="newStyle"
                checked={newStyle === style}
                onChange={() => setNewStyle(style)}
                label={STYLE_TEXT[style]()}
              />
            ))}
          </fieldset>
          {all.map((page) => {
            const own = boxes.filter((box) => box.page === page)
            return (
              <section
                key={page}
                aria-labelledby={`halaman-${page}`}
                className="flex flex-col gap-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 id={`halaman-${page}`} className="font-bold text-lg">
                    {props.kind === "pdf"
                      ? m.manage_evidence_page({ page: page + 1 })
                      : m.manage_evidence_item({ position })}
                  </h2>
                  {props.kind === "pdf" ? (
                    <Checkbox
                      inline
                      id={`${PAGES_FIELD}-${page}`}
                      name="pages"
                      value={page}
                      checked={pages.includes(page)}
                      onChange={(event) => {
                        const on = event.currentTarget.checked
                        setPages((list) =>
                          on
                            ? [...list, page].sort((a, b) => a - b)
                            : list.filter((p) => p !== page),
                        )
                      }}
                      label={m.manage_evidence_publish_page({ page: page + 1 })}
                    />
                  ) : null}
                </div>
                <PageCanvas
                  src={`${base}/${page}.webp`}
                  alt={
                    props.kind === "pdf"
                      ? m.manage_evidence_page_alt({ page: page + 1, position })
                      : m.manage_evidence_alt({
                          position,
                          code: props.reportCode,
                        })
                  }
                  page={page}
                  boxes={own}
                  newStyle={newStyle}
                  hintId={hintId}
                  onAdd={add}
                  onChange={change(page)}
                  onRemove={remove(page)}
                />
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => add(centeredBox(page, newStyle))}
                  >
                    {m.manage_evidence_add_box()}
                  </Button>
                </div>
                <BoxList
                  boxes={own}
                  onChange={change(page)}
                  onRemove={remove(page)}
                />
              </section>
            )
          })}
          {pagesError ? (
            <div id={PAGES_FIELD} tabIndex={-1}>
              <ErrorMessage id={PAGES_FIELD}>{pagesError}</ErrorMessage>
            </div>
          ) : null}
        </>
      )}
      <DecisionField
        allowed={decisions}
        value={decision}
        onChange={setDecision}
        error={firstError(errors, [
          "decision",
          "boxes_required",
          "boxes_not_allowed",
        ])}
      />
      <div>
        <Button type="submit" variant="dark" pending={props.pending}>
          {m.manage_evidence_save()}
        </Button>
      </div>
    </Form>
  )
}
