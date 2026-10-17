import { CircleAlert } from "lucide-react"
import { useEffect, useId, useRef } from "react"
import { m } from "~/paraglide/messages.js"

export type FieldError = { fieldId: string; message: string }

export function errorTitle(title: string, hasErrors: boolean): string {
  return hasErrors ? m.error_page_title({ title }) : title
}

type ErrorSummaryProps = {
  errors: FieldError[]
  // New value per failed submit
  attempt?: unknown
}

// Focused on mount, above H1
export function ErrorSummary({ errors, attempt }: ErrorSummaryProps) {
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId()
  // Errors or submit changed
  const errorKey = errors.map((e) => `${e.fieldId}:${e.message}`).join("|")

  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt is the trigger
  useEffect(() => {
    if (errorKey) ref.current?.focus()
  }, [errorKey, attempt])

  if (errors.length === 0) return null
  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="alert"
      aria-labelledby={titleId}
      className="mb-8 flex gap-3 border-danger border-l-4 bg-danger-soft p-5 text-danger-ink focus-visible:outline-ink"
    >
      <CircleAlert aria-hidden="true" className="mt-0.5 size-6 shrink-0" />
      <div>
        <h2 id={titleId} className="font-bold text-xl leading-snug">
          {m.error_summary_title()}
        </h2>
        <ul className="mt-3 flex flex-col gap-2">
          {errors.map((e) => (
            <li key={e.fieldId}>
              <a
                href={`#${e.fieldId}`}
                className="font-semibold underline underline-offset-4"
              >
                {e.message}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
