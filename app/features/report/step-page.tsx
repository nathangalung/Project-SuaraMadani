import { ChevronLeft } from "lucide-react"
import {
  type Dispatch,
  type FocusEvent,
  type FormEvent,
  type ReactNode,
  type SetStateAction,
  useState,
} from "react"
import {
  Link,
  useMatches,
  useNavigate,
  useOutletContext,
  useSearchParams,
} from "react-router"
import { Button } from "~/components/ui/button"
import {
  ErrorSummary,
  errorTitle,
  untouched,
} from "~/components/ui/error-summary"
import { STEP_HEADING } from "~/components/ui/field"
import { Skeleton } from "~/components/ui/skeleton"
import { m } from "~/paraglide/messages.js"
import { REPORT_STEPS, type ReportStep } from "../../../shared/report-fields.ts"
import { STEP_PATHS } from "./draft-store"
import { ERROR_TEXT, STEP_TITLE_TEXT } from "./labels"
import { useSiteTitle } from "./page-title"
import { StepProgress, useDoneSteps } from "./step-list"
import type { StepError } from "./validate"

// Change links return here
export const RETURN_PARAM = "dari"
export const RETURN_VALUE = "periksa"

export type ReportOutlet = { paused: boolean; statusHref: string | null }

// Null: no step chrome
export type ReportHandle = { reportStep: ReportStep | null }

/** Step from a route handle. */
export function stepOfHandle(handle: unknown): ReportStep | null | undefined {
  if (typeof handle !== "object" || handle === null) return undefined
  if (!("reportStep" in handle)) return undefined
  const step = handle.reportStep
  if (step === null) return null
  return REPORT_STEPS.find((known) => known === step)
}

/** Current step of the page. */
export function useCurrentStep(): ReportStep | null | undefined {
  const matches = useMatches()
  return stepOfHandle(matches.at(-1)?.handle)
}

const BACK_LINK =
  "mb-4 inline-flex items-center gap-1 font-semibold text-ink text-sm hover:underline hover:underline-offset-4"

export function BackLink({ to }: { to: string }) {
  return (
    <Link to={to} className={BACK_LINK}>
      <ChevronLeft aria-hidden="true" className="size-4" />
      {m.report_back()}
    </Link>
  )
}

// Caption, bar, then question
export function StepHeading({
  step,
  children,
}: {
  step: ReportStep
  children?: ReactNode
}) {
  return (
    <div>
      <StepProgress current={step} done={useDoneSteps()} />
      {children}
    </div>
  )
}

export function errorText(errors: StepError[], field: string) {
  const found = errors.find((error) => error.field === field)
  return found ? ERROR_TEXT[found.key]() : undefined
}

/** Back target and next navigation. */
export function useStepNav(step: ReportStep) {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const index = REPORT_STEPS.indexOf(step)
  const previous = REPORT_STEPS[index - 1]
  const following = REPORT_STEPS[index + 1] ?? "consent"
  const returning = params.get(RETURN_PARAM) === RETURN_VALUE
  return {
    backTo: returning
      ? STEP_PATHS.consent
      : previous
        ? STEP_PATHS[previous]
        : "/",
    next: () =>
      navigate(returning ? STEP_PATHS.consent : STEP_PATHS[following]),
  }
}

export function PausedBanner() {
  const { paused, statusHref } = useOutletContext<ReportOutlet>()
  if (!paused) return null
  return (
    <div role="status" className="mb-6 text-sm leading-relaxed">
      <h2 className="font-bold text-base">{m.report_paused_title()}</h2>
      <p className="mt-1">{m.report_paused_body()}</p>
      {statusHref ? (
        <p className="mt-2">
          <a
            href={statusHref}
            className="font-semibold underline underline-offset-4 hover:decoration-2"
          >
            {m.intake_banner_status()}
          </a>
        </p>
      ) : null}
    </div>
  )
}

// Hydrated card heights, b5c measured
const FALLBACK_HEIGHT: Record<ReportStep, string> = {
  relation: "min-h-111 sm:min-h-112",
  location: "min-h-182 sm:min-h-129 lg:min-h-135",
  details: "min-h-387 sm:min-h-325 lg:min-h-331",
  impact: "min-h-262 sm:min-h-181",
  evidence: "min-h-148 sm:min-h-149",
  contact: "min-h-93 sm:min-h-89 lg:min-h-106",
  consent: "min-h-443 sm:min-h-360 lg:min-h-367",
}

// Same spot as hydrated link
function FallbackBack({ step }: { step: ReportStep }) {
  return <BackLink to={useStepNav(step).backTo} />
}

// Server HTML and no-JS view
export function StepFallback() {
  const step = useCurrentStep()
  const title = step ? STEP_TITLE_TEXT[step]() : m.report_title()
  return (
    // No-JS view stays short
    <div className={`${step ? FALLBACK_HEIGHT[step] : ""} noscript:min-h-0`}>
      <title>{useSiteTitle(title)}</title>
      {step && <FallbackBack step={step} />}
      <noscript>
        <div className="mb-6">
          <p className="font-semibold">{m.report_noscript()}</p>
          <Link
            to="/"
            className="mt-2 inline-block font-semibold underline underline-offset-4"
          >
            {m.report_noscript_link()}
          </Link>
        </div>
      </noscript>
      {step ? (
        <StepHeading step={step}>
          <h1 className={`mt-5 ${STEP_HEADING}`}>{title}</h1>
        </StepHeading>
      ) : (
        <h1 className={STEP_HEADING}>{title}</h1>
      )}
      {/* Same size as the form */}
      <Skeleton className="mt-6 h-5 w-40" />
      <Skeleton className="mt-3 h-12 w-full rounded-md" />
      <Skeleton className="mt-6 h-5 w-48" />
      <Skeleton className="mt-3 h-12 w-full rounded-md" />
    </div>
  )
}

type StepPageProps = {
  step: ReportStep
  title: string
  // Legend is the H1 instead
  titleInForm?: boolean
  // Explains the red asterisk
  requiredNote?: boolean
  errors: StepError[]
  // Edit clears its error
  setErrors?: Dispatch<SetStateAction<StepError[]>>
  // Checks typed field on leave
  validate?: (form: HTMLFormElement) => StepError[]
  onContinue: (form: HTMLFormElement) => void
  children: ReactNode
}

// One question per page
export function StepPage({
  step,
  title,
  titleInForm,
  requiredNote = true,
  errors,
  setErrors,
  validate,
  onContinue,
  children,
}: StepPageProps) {
  const { backTo } = useStepNav(step)
  const pageTitle = useSiteTitle(title)
  // Same errors still refocus
  const [attempt, setAttempt] = useState(0)
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setAttempt((value) => value + 1)
    onContinue(event.currentTarget)
  }
  // Edited field drops its red
  const clearEdited = (event: FormEvent<HTMLFormElement>) => {
    const { target } = event
    setErrors?.((current) => untouched(current, (e) => e.field, target))
  }
  // Typed then left: show now
  const checkLeft = (event: FocusEvent<HTMLFormElement>) => {
    const field = event.target
    const typed =
      (field instanceof HTMLInputElement &&
        !["radio", "checkbox", "file"].includes(field.type)) ||
      field instanceof HTMLTextAreaElement
    if (!validate || !setErrors || !typed || field.value.trim() === "") return
    const inField = (error: StepError) =>
      document.getElementById(error.field)?.contains(field) ?? false
    const found = validate(event.currentTarget).filter(inField)
    setErrors((current) => [
      ...current.filter((error) => !inField(error)),
      ...found,
    ])
  }
  return (
    <>
      <title>{errorTitle(pageTitle, errors.length > 0)}</title>
      <BackLink to={backTo} />
      <PausedBanner />
      <ErrorSummary
        attempt={attempt}
        errors={errors.map((error) => ({
          fieldId: error.field,
          message: ERROR_TEXT[error.key](),
        }))}
      />
      <StepHeading step={step}>
        {!titleInForm && <h1 className={`mt-5 ${STEP_HEADING}`}>{title}</h1>}
      </StepHeading>
      <form
        noValidate
        onSubmit={submit}
        onChange={clearEdited}
        onBlur={checkLeft}
        className="mt-6 flex flex-1 flex-col"
      >
        <div className="flex flex-col gap-6">{children}</div>
        <div className="mt-auto pt-8">
          {requiredNote && (
            <p className="mb-4 font-ui text-ink-muted text-sm">
              {m.field_required_note()}
            </p>
          )}
          <Button
            type="submit"
            variant="dark"
            className="w-full sm:w-auto sm:min-w-32"
          >
            {m.report_continue()}
          </Button>
        </div>
      </form>
    </>
  )
}

/** Trimmed string or undefined. */
export function formText(form: FormData, name: string): string | undefined {
  const value = form.get(name)
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed === "" ? undefined : trimmed
}
