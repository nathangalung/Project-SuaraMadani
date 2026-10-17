import { Check } from "lucide-react"
import { cn } from "~/components/ui/cn"
import { Note } from "~/components/ui/note"
import { m } from "~/paraglide/messages.js"
import type { GovernmentStatus } from "../../../shared/status.ts"
import { GOVERNMENT_TEXT } from "./labels"

// Government axis main path
export const TRACKER_STEPS = [
  "awaiting_response",
  "responded",
  "in_progress",
  "claimed_resolved",
  "confirmed_resolved",
] as const satisfies readonly GovernmentStatus[]

type OffPath = Exclude<GovernmentStatus, (typeof TRACKER_STEPS)[number]>

// Last step surely reached
const LAST_REACHED: Record<OffPath, number> = {
  reopened: 3,
  not_competent: 1,
  not_followed_up: 0,
  closed: 0,
}

const OFF_PATH_NOTE: Record<OffPath, () => string> = {
  reopened: m.tracker_note_reopened,
  not_competent: m.tracker_note_not_competent,
  not_followed_up: m.tracker_note_not_followed_up,
  closed: m.tracker_note_closed,
}

export type TrackerState = {
  // Last step reached
  reached: number
  current: boolean
  offPath: OffPath | null
}

/** Main path position, PLAN §5.4. */
export function trackerState(status: GovernmentStatus): TrackerState {
  const index = (TRACKER_STEPS as readonly string[]).indexOf(status)
  if (index >= 0) return { reached: index, current: true, offPath: null }
  const offPath = status as OffPath
  return { reached: LAST_REACHED[offPath], current: false, offPath }
}

export function StatusTracker({
  status,
  labelledBy,
}: {
  status: GovernmentStatus
  labelledBy: string
}) {
  const state = trackerState(status)
  return (
    <>
      <ol
        aria-labelledby={labelledBy}
        className="mt-6 grid gap-3 sm:grid-cols-5 sm:gap-0"
      >
        {TRACKER_STEPS.map((step, i) => {
          const current = state.current && i === state.reached
          const done = !current && i <= state.reached
          return (
            <li
              key={step}
              aria-current={current ? "step" : undefined}
              className="relative flex items-center gap-3 sm:flex-col sm:items-start sm:gap-2.5 sm:pr-3"
            >
              {i < TRACKER_STEPS.length - 1 && (
                <span
                  aria-hidden="true"
                  className={cn(
                    "absolute top-[1.125rem] left-10 hidden h-1 w-[calc(100%-2.5rem)] sm:block",
                    i < state.reached ? "bg-ink" : "bg-ink/12",
                  )}
                />
              )}
              <span
                aria-hidden="true"
                className={cn(
                  "relative grid size-10 shrink-0 place-items-center font-semibold text-base",
                  current
                    ? "bg-brand text-on-accent shadow-[0_0_0_4px_color-mix(in_srgb,var(--theme-brand)_20%,transparent)]"
                    : done
                      ? "bg-ink text-surface-raised"
                      : "border-2 border-ink/25 bg-surface-raised text-ink-muted",
                )}
              >
                {done ? <Check className="size-5" /> : i + 1}
              </span>
              <span
                className={cn(
                  "font-semibold text-sm",
                  current
                    ? "text-accent"
                    : done
                      ? "text-ink"
                      : "text-ink-muted",
                )}
              >
                {GOVERNMENT_TEXT[step]()}
                {current ? (
                  <span className="sr-only"> {m.tracker_step_current()}</span>
                ) : done ? (
                  <span className="sr-only"> {m.tracker_step_done()}</span>
                ) : null}
              </span>
            </li>
          )
        })}
      </ol>
      {state.offPath ? (
        <Note className="mt-6">
          <strong className="font-semibold">
            {m.tracker_note_label({
              status: GOVERNMENT_TEXT[state.offPath](),
            })}
          </strong>{" "}
          {OFF_PATH_NOTE[state.offPath]()}
        </Note>
      ) : null}
    </>
  )
}
