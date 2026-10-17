import { useMatches } from "react-router"
import { m } from "~/paraglide/messages.js"
import { latestIsoDate } from "../../../shared/format.ts"
import { REPORT_STEPS, type ReportStep } from "../../../shared/report-fields.ts"
import { type Draft, entryOf, memory } from "./draft"
import { STEP_DESC_TEXT, STEP_TITLE_TEXT } from "./labels"
import { completedSteps } from "./validate"

const NONE: ReadonlySet<ReportStep> = new Set()

/** Draft exists after clientLoader. */
export function useDoneSteps(): ReadonlySet<ReportStep> {
  const data = useMatches().at(-1)?.loaderData
  if (typeof data !== "object" || data === null || !("draft" in data)) {
    return NONE
  }
  const draft = data.draft as Draft
  return completedSteps(draft, latestIsoDate(new Date()), {
    files: memory.files.map(entryOf),
  })
}

// PLAN §7: not clickable
export function StepList({
  current,
  done,
}: {
  current: ReportStep
  done: ReadonlySet<ReportStep>
}) {
  return (
    <ol
      aria-label={m.report_steps_label()}
      className="border-line-subtle border-l"
    >
      {REPORT_STEPS.map((step, index) => {
        const isCurrent = step === current
        const isDone = done.has(step)
        return (
          <li
            key={step}
            aria-current={isCurrent ? "step" : undefined}
            className={
              isCurrent
                ? "-ml-px border-brand border-l-2 py-2.5 pl-4 font-semibold text-ink"
                : `-ml-px border-transparent border-l-2 py-2.5 pl-4 ${isDone ? "text-ink" : "text-ink-muted"}`
            }
          >
            <span className="block">
              {index + 1}. {STEP_TITLE_TEXT[step]()}
              {!isCurrent && (
                <span className="sr-only">
                  {" "}
                  ({isDone ? m.report_step_done() : m.report_step_todo()})
                </span>
              )}
            </span>
            <span className="block font-normal font-ui text-ink-muted text-sm">
              {STEP_DESC_TEXT[step]()}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

// Ink means answered, as StepList
export function StepProgress({
  current,
  done,
}: {
  current: ReportStep
  done: ReadonlySet<ReportStep>
}) {
  const position = REPORT_STEPS.indexOf(current)
  return (
    <>
      <p className="font-semibold font-ui text-ink-muted text-sm">
        {m.report_step_count({
          current: position + 1,
          total: REPORT_STEPS.length,
        })}
      </p>
      <div aria-hidden="true" className="mt-3 grid grid-cols-7 gap-1">
        {REPORT_STEPS.map((step) => (
          <span
            key={step}
            className={`h-1.5 rounded-full ${step === current ? "bg-brand" : done.has(step) ? "bg-ink" : "bg-ink/12"}`}
          />
        ))}
      </div>
    </>
  )
}
