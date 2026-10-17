// Admin decision parser, server only
import { z } from "zod"
import {
  BOX_SCALE,
  EVIDENCE_DECISIONS,
  type EvidenceDecision,
  MAX_BOXES,
  MIN_BOX,
  REDACTION_STYLES,
  type RedactionBox,
} from "./evidence.ts"
import type { EvidenceKind } from "./report-fields.ts"

const unit = z.number().int().min(0).max(BOX_SCALE)

const boxSchema = z
  .object({
    page: z.number().int().min(0),
    x: unit,
    y: unit,
    w: unit.min(MIN_BOX),
    h: unit.min(MIN_BOX),
    style: z.enum(REDACTION_STYLES),
  })
  .strict()
  .refine((b) => b.x + b.w <= BOX_SCALE && b.y + b.h <= BOX_SCALE)
  .transform((b): RedactionBox => b)

const decisionSchema = z.object({
  decision: z.enum(EVIDENCE_DECISIONS),
  boxes: z.array(boxSchema).max(MAX_BOXES).optional(),
  pages: z.array(z.number().int().min(0)).optional(),
})

type ParsedDecision = {
  decision: EvidenceDecision
  boxes: RedactionBox[]
  // Preview pages to publish
  pages: number[]
}

export type DecisionError =
  | "invalid"
  | "boxes_required"
  | "boxes_not_allowed"
  | "video_no_boxes"
  | "pages_required"

type DecisionResult =
  | { ok: true; value: ParsedDecision }
  | { ok: false; error: DecisionError }

/** editEvidence input, PLAN §5.10. */
export function parseDecision(
  target: { kind: EvidenceKind; pages: number },
  raw: unknown,
): DecisionResult {
  const parsed = decisionSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, error: "invalid" }
  const { decision } = parsed.data
  const boxes = parsed.data.boxes ?? []
  if (target.kind === "video") {
    if (decision === "redact" || boxes.length > 0) {
      return { ok: false, error: "video_no_boxes" }
    }
    return { ok: true, value: { decision, boxes: [], pages: [] } }
  }
  const all = Array.from({ length: target.pages }, (_, i) => i)
  const pages =
    target.kind === "pdf" && parsed.data.pages
      ? [...new Set(parsed.data.pages)].sort((a, b) => a - b)
      : all
  if (pages.some((page) => page >= target.pages)) {
    return { ok: false, error: "invalid" }
  }
  if (decision === "withhold") {
    return { ok: true, value: { decision, boxes: [], pages: [] } }
  }
  if (pages.length === 0) return { ok: false, error: "pages_required" }
  if (boxes.some((box) => !pages.includes(box.page))) {
    return { ok: false, error: "invalid" }
  }
  if (decision === "redact" && boxes.length === 0) {
    return { ok: false, error: "boxes_required" }
  }
  if (decision === "no_redaction" && boxes.length > 0) {
    return { ok: false, error: "boxes_not_allowed" }
  }
  return { ok: true, value: { decision, boxes, pages } }
}
