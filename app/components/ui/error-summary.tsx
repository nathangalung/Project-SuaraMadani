import { useEffect, useRef } from "react"
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

/** Errors the edit left alone. */
export function untouched<E>(
  errors: E[],
  idOf: (error: E) => string,
  target: EventTarget | null,
): E[] {
  if (!(target instanceof Node)) return errors
  const left = errors.filter(
    (error) => !document.getElementById(idOf(error))?.contains(target),
  )
  return left.length === errors.length ? errors : left
}

const FOCUSABLE =
  "input:not([type=hidden]), select, textarea, button, a[href], [tabindex]"

/** Field, or its first control. */
export function focusField(id: string): void {
  const field = document.getElementById(id)
  if (!field) return
  const target = field.matches(FOCUSABLE)
    ? field
    : field.querySelector<HTMLElement>(FOCUSABLE)
  if (target) {
    target.focus()
    return
  }
  // Groups without a control
  field.setAttribute("tabindex", "-1")
  field.focus()
}

// No box, field errors show
export function ErrorSummary({ errors, attempt }: ErrorSummaryProps) {
  // Errors or submit changed
  const errorKey = errors.map((e) => `${e.fieldId}:${e.message}`).join("|")
  const first = errors[0]?.fieldId

  const last = useRef<{ attempt: unknown; keys: string[] } | null>(null)

  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt is the trigger
  useEffect(() => {
    const keys = errorKey ? errorKey.split("|") : []
    const before = last.current
    last.current = { attempt, keys }
    // Only new submits move focus
    const submitted =
      attempt === undefined ? true : !before || before.attempt !== attempt
    if (!submitted || !first) return
    // Edits only shrink the list
    const shrank =
      before !== null &&
      keys.length < before.keys.length &&
      keys.every((key) => before.keys.includes(key))
    if (!shrank) focusField(first)
  }, [errorKey, attempt])

  if (errors.length === 0) return null
  // Read after the focused field
  return (
    <div role="status" className="sr-only">
      <p>{m.error_summary_title()}</p>
      <ul>
        {errors.map((e) => (
          <li key={e.fieldId}>{e.message}</li>
        ))}
      </ul>
    </div>
  )
}
