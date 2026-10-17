import { Lock } from "lucide-react"
import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react"
import { Link, useFetcher, useNavigate } from "react-router"
import { Button } from "~/components/ui/button"
import {
  ErrorSummary,
  errorTitle,
  type FieldError,
} from "~/components/ui/error-summary"
import {
  Checkbox,
  ErrorMessage,
  Fieldset,
  STEP_HEADING,
} from "~/components/ui/field"
import { Note } from "~/components/ui/note"
import { m } from "~/paraglide/messages.js"
import { needsEmergencyBanner } from "../../../shared/categories.ts"
import { formatDate } from "../../../shared/format.ts"
import {
  CONSENT_KEYS,
  type ConsentKey,
  type ReportErrorKey,
} from "../../../shared/report-fields.ts"
import { CATEGORY_SHORT_TEXT } from "./category-labels"
import {
  browserStorage,
  buildSubmission,
  type ConsentAnswers,
  clearDraft,
  type Draft,
  type DraftStep,
  type EvidenceEntry,
  entryOf,
  memory,
  NO_CONSENTS,
} from "./draft"
import { STEP_PATHS } from "./draft-store"
import { EmergencyBanner } from "./emergency"
import { INPUT_ID } from "./evidence-picker"
import { uploadFiles } from "./evidence-upload"
import { focusById, useOnChange } from "./focus"
import {
  CONTACTABLE_TEXT,
  COUNT_TEXT,
  ERROR_TEXT,
  GROUP_TEXT,
  METHOD_TEXT,
  ONGOING_TEXT,
  OTHER_CONSENT_TEXT,
  RELATION_TEXT,
  STEP_TITLE_TEXT,
  URGENCY_TEXT,
} from "./labels"
import { useSiteTitle } from "./page-title"
import { labelOf, SUBCATEGORY_TEXT } from "./public-labels"
import { SignedInAs, SignIn } from "./sign-in"
import {
  BackLink,
  PausedBanner,
  RETURN_PARAM,
  RETURN_VALUE,
  StepHeading,
} from "./step-page"
import type {
  SubmitFailure,
  SubmitFieldError,
  SubmittedReport,
} from "./submit.server"
import { captchaWait, Turnstile } from "./turnstile"
import { missingEntries, stepProblems } from "./validate"

type SubmitResponse =
  | SubmittedReport
  | { errors: SubmitFieldError[] }
  | { error: SubmitFailure }

const CONSENT_ERRORS: Partial<Record<ConsentKey, ReportErrorKey>> = {
  age_18_plus: "error_consent_age_required",
  accurate: "error_consent_accurate_required",
  public_issue: "error_consent_public_issue_required",
  aggregate_processing: "error_consent_aggregate_required",
}

const FAILURE_TEXT: Record<SubmitFailure, () => string> = {
  sign_in_required: m.error_sign_in_required,
  captcha_failed: m.error_captcha_failed,
  quota_exceeded: m.error_quota_exceeded,
  intake_paused: m.error_intake_paused,
  too_large: m.error_submit_failed,
}

export const SIGN_IN_TITLE_ID = "sign-in-title"
const CONSENT_TITLE_ID = "consent-title"
const CONSENT_GROUP_ID = "consent-group"

const rowId = (step: string) => `row-${step}`
const consentId = (key: string) => `consent-${key}`

function isDraftStep(step: string | undefined): step is DraftStep {
  return step !== undefined && step !== "consent" && step in STEP_TITLE_TEXT
}

/** Summary links need unique targets. */
function firstPerField(errors: FieldError[]): FieldError[] {
  const seen = new Set<string>()
  return errors.filter(({ fieldId }) => {
    if (seen.has(fieldId)) return false
    seen.add(fieldId)
    return true
  })
}

export function serverErrors(errors: SubmitFieldError[]): FieldError[] {
  return firstPerField(
    errors.map(({ path, key }) => {
      const [step, , consent] = path.split(".")
      if (step === "consent") {
        const fieldId = consent ? consentId(consent) : CONSENT_GROUP_ID
        return { fieldId, message: ERROR_TEXT[key]() }
      }
      if (!isDraftStep(step)) {
        return { fieldId: "submit", message: ERROR_TEXT[key]() }
      }
      // Generic text names wrong step
      const message =
        key === "error_step_required"
          ? m.error_step_incomplete({ step: STEP_TITLE_TEXT[step]() })
          : ERROR_TEXT[key]()
      return { fieldId: rowId(step), message }
    }),
  )
}

export function failureError(error: SubmitFailure): FieldError {
  return {
    fieldId: error === "sign_in_required" ? SIGN_IN_TITLE_ID : "submit",
    message: FAILURE_TEXT[error](),
  }
}

function Row({
  step,
  label,
  value,
  repick,
}: {
  step: DraftStep
  label: string
  value: ReactNode
  // Lost photos: land on picker
  repick?: boolean
}) {
  const empty = value === undefined || value === "" || value === null
  const back = `${STEP_PATHS[step]}?${RETURN_PARAM}=${RETURN_VALUE}`
  return (
    <div className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5 sm:grid-cols-[9rem_1fr_auto]">
      <dt className="font-ui text-ink-muted text-sm sm:pt-0.5">{label}</dt>
      {/* Mobile: link beside label */}
      <dd
        className={`col-span-2 row-start-2 whitespace-pre-line break-words sm:col-span-1 sm:col-start-2 sm:row-start-1 ${empty ? "text-ink-muted" : ""}`}
      >
        {empty ? m.review_not_filled() : value}
      </dd>
      <dd className="col-start-2 row-start-1 sm:col-start-3">
        <Link
          to={repick ? `${back}#${INPUT_ID}` : back}
          className="font-semibold text-accent text-sm underline underline-offset-4 hover:no-underline"
        >
          {repick ? m.review_repick() : m.review_change()}
          <span className="sr-only"> {label.toLowerCase()}</span>
        </Link>
      </dd>
    </div>
  )
}

// Errors appear only after submit
export function Summary({
  draft,
  errors,
  missing,
  phone = null,
}: {
  draft: Draft
  errors: FieldError[]
  missing: EvidenceEntry[]
  // Masked account number, signed in
  phone?: string | null
}) {
  const { relation, location, details, impact, contact } = draft
  const errorFor = (step: DraftStep) =>
    errors.find((error) => error.fieldId === rowId(step))?.message
  const occurred = details?.occurredOn
  const category = labelOf(CATEGORY_SHORT_TEXT, details?.categoryId)
  const subcategory = labelOf(SUBCATEGORY_TEXT, details?.subcategoryId)
  const groups = (impact?.groups ?? [])
    .map((group) => labelOf(GROUP_TEXT, group))
    .filter(Boolean)
    .join(", ")
  const steps: [DraftStep, [string, ReactNode][]][] = [
    [
      "relation",
      [
        [m.review_relation(), labelOf(RELATION_TEXT, relation?.relation)],
        ...(relation?.relation === "on_behalf"
          ? ([
              [
                m.review_other_consent(),
                labelOf(OTHER_CONSENT_TEXT, relation.otherConsent),
              ],
            ] as [string, ReactNode][])
          : []),
      ],
    ],
    ["location", [[m.review_location(), location?.label]]],
    [
      "details",
      [
        [m.review_title(), details?.title],
        [m.review_story(), details?.story],
        [
          m.review_category(),
          category && subcategory ? `${category}: ${subcategory}` : category,
        ],
        [
          m.review_occurred(),
          occurred ? formatDate(new Date(`${occurred}T12:00:00Z`)) : undefined,
        ],
        [m.review_agency(), details?.agency],
        [m.review_urgency(), labelOf(URGENCY_TEXT, details?.urgency)],
      ],
    ],
    [
      "impact",
      [
        [m.review_groups(), groups],
        [m.review_count(), labelOf(COUNT_TEXT, impact?.affectedCount)],
        [m.review_ongoing(), labelOf(ONGOING_TEXT, impact?.ongoing)],
      ],
    ],
    [
      "evidence",
      [
        [
          m.review_evidence(),
          [
            ...memory.files.map((file) => file.name),
            ...missing.map((entry) => m.evidence_missing({ name: entry.name })),
          ].join("\n"),
        ],
      ],
    ],
    [
      "contact",
      [
        [m.review_contact(), labelOf(CONTACTABLE_TEXT, contact?.contactable)],
        ...(contact?.contactable === "yes"
          ? ([
              [m.review_phone(), phone ?? m.review_phone_account()],
              [m.review_method(), labelOf(METHOD_TEXT, contact.method)],
            ] as [string, ReactNode][])
          : []),
      ],
    ],
  ]
  // One section per step
  return (
    <div className="mt-6">
      {steps.map(([step, rows]) => (
        <section
          key={step}
          id={rowId(step)}
          tabIndex={-1}
          aria-labelledby={`${rowId(step)}-title`}
          className={`border-line-subtle border-b py-4 first:pt-0 ${errorFor(step) ? "border-l-4 border-l-danger pl-4" : ""}`}
        >
          <h2 id={`${rowId(step)}-title`} className="mb-3 font-bold text-lg">
            {STEP_TITLE_TEXT[step]()}
          </h2>
          {errorFor(step) && (
            <div className="mb-3">
              <ErrorMessage id={rowId(step)}>
                {errorFor(step) ?? ""}
              </ErrorMessage>
            </div>
          )}
          <dl className="flex flex-col gap-2.5">
            {rows.map(([label, value]) => (
              <Row
                key={label}
                step={step}
                label={label}
                value={value}
                repick={step === "evidence" && missing.length > 0}
              />
            ))}
          </dl>
        </section>
      ))}
    </div>
  )
}

type Flow =
  | { kind: "idle" }
  | { kind: "uploading"; current: number; total: number; percent: number }
  | { kind: "upload_failed"; report: SubmittedReport; failed: number[] }

type ReviewProps = {
  draft: Draft
  today: string
  signedInAs: string | null
  signedInPhone?: string | null
  // Admins call proven numbers only
  signedInPhoneVerified?: boolean
  siteKey: string
  operator: string
  // Revalidates the session loader
  onSessionChange: () => void
}

export function Review({
  draft,
  today,
  signedInAs,
  signedInPhone = null,
  signedInPhoneVerified = true,
  siteKey,
  operator,
  onSessionChange,
}: ReviewProps) {
  const fetcher = useFetcher<SubmitResponse>()
  const navigate = useNavigate()
  const [consents, setConsents] = useState<ConsentAnswers>(NO_CONSENTS)
  const [token, setToken] = useState<string | null>(null)
  const [captchaFailed, setCaptchaFailed] = useState(false)
  const [generation, setGeneration] = useState(0)
  const [errors, setErrors] = useState<FieldError[]>([])
  const [flow, setFlow] = useState<Flow>({ kind: "idle" })
  const handled = useRef<unknown>(null)
  const missing = missingEntries(draft.evidence, memory.files)
  const emergency = needsEmergencyBanner(draft.details ?? {})
  const pageTitle = useSiteTitle(m.step_review_title())

  // Sign-in form was replaced
  useOnChange(signedInAs, () => {
    if (signedInAs === null) return
    setErrors([])
    focusById(document, CONSENT_TITLE_ID)
  })

  const finish = (report: SubmittedReport, filesFailed: boolean) => {
    clearDraft(browserStorage())
    navigate(`/lapor/sukses/${report.code}`, {
      replace: true,
      state: { filesFailed, emergency, sentAt: new Date().toISOString() },
    })
  }

  const upload = async (report: SubmittedReport, only?: number[]) => {
    const items = report.evidence
      .filter((row) => !only || only.includes(row.position))
      .flatMap((row) => {
        const file = memory.files[row.position]
        return file ? [{ id: row.id, file, position: row.position }] : []
      })
    const total = items.length
    setFlow({ kind: "uploading", current: 1, total, percent: 0 })
    const { failed } = await uploadFiles(items, {
      onProgress: (index, fraction) =>
        setFlow({
          kind: "uploading",
          current: index + 1,
          total,
          percent: Math.round(fraction * 100),
        }),
    })
    if (failed.length === 0) return finish(report, false)
    setFlow({
      kind: "upload_failed",
      report,
      failed: failed.flatMap(({ index }) => {
        const item = items[index]
        return item ? [item.position] : []
      }),
    })
  }

  useEffect(() => {
    const data = fetcher.data
    if (fetcher.state !== "idle" || !data || handled.current === data) return
    handled.current = data
    // Token is spent either way
    setGeneration((value) => value + 1)
    if ("code" in data) {
      setErrors([])
      void upload(data)
    } else if ("errors" in data) {
      setErrors(serverErrors(data.errors))
    } else {
      setErrors([failureError(data.error)])
      // Stale signedInAs hides sign-in
      if (data.error === "sign_in_required") onSessionChange()
    }
  })

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const held = { files: memory.files.map(entryOf) }
    const found: FieldError[] = Object.entries(
      stepProblems(draft, today, held),
    ).map(([step, problem]) => ({
      fieldId: rowId(step),
      message: ERROR_TEXT[problem.key](),
    }))
    if (missing.length > 0) {
      found.push({
        fieldId: rowId("evidence"),
        message: m.error_files_missing({
          names: missing.map((entry) => entry.name).join(", "),
        }),
      })
    }
    for (const [key, errorKey] of Object.entries(CONSENT_ERRORS)) {
      if (errorKey && !consents[key as ConsentKey]) {
        found.push({ fieldId: consentId(key), message: ERROR_TEXT[errorKey]() })
      }
    }
    if (!token) {
      found.push({
        fieldId: "submit-captcha",
        message: captchaWait(captchaFailed),
      })
    }
    setErrors(firstPerField(found))
    if (found.length > 0 || !token) return
    // String form drops undefined fields
    fetcher.submit(JSON.stringify(buildSubmission(draft, consents, token)), {
      method: "post",
      encType: "application/json",
    })
  }

  const busy = fetcher.state !== "idle" || flow.kind === "uploading"
  const errorFor = (id: string) => errors.find((e) => e.fieldId === id)?.message

  return (
    <>
      <title>{errorTitle(pageTitle, errors.length > 0)}</title>
      <BackLink to={STEP_PATHS.contact} />
      <PausedBanner />
      <ErrorSummary errors={errors} attempt={errors} />
      <StepHeading step="consent">
        <h1 className={`mt-5 ${STEP_HEADING}`}>{m.step_review_title()}</h1>
      </StepHeading>
      {emergency && (
        <div className="mt-6">
          <EmergencyBanner />
        </div>
      )}
      <div>
        <Summary
          draft={draft}
          errors={errors}
          missing={missing}
          phone={
            signedInAs !== null && !signedInPhone
              ? m.review_phone_missing()
              : signedInPhone && !signedInPhoneVerified
                ? m.review_phone_unverified({ phone: signedInPhone })
                : signedInPhone
          }
        />
        {signedInAs === null ? (
          <section
            aria-labelledby={SIGN_IN_TITLE_ID}
            className="mt-6 flex flex-col gap-5 border-brand border-l-4 bg-surface p-4 sm:p-5"
          >
            <h2
              id={SIGN_IN_TITLE_ID}
              tabIndex={-1}
              className="font-bold text-lg"
            >
              {m.review_sign_in_title()}
            </h2>
            <SignIn siteKey={siteKey} onSignedIn={onSessionChange} />
            <SignInPrivacy />
          </section>
        ) : (
          <form
            noValidate
            onSubmit={submit}
            className="mt-6 flex flex-col gap-6"
          >
            <p className="font-ui text-ink-muted text-sm">
              <SignedInAs email={signedInAs} />
            </p>
            <Fieldset
              id={CONSENT_GROUP_ID}
              legend={
                <h2
                  id={CONSENT_TITLE_ID}
                  tabIndex={-1}
                  className="font-bold text-lg"
                >
                  {m.review_consent_title()}
                </h2>
              }
              hint={<ConsentHint />}
              error={errorFor(CONSENT_GROUP_ID)}
              optionsClassName="grid gap-2.5"
            >
              {CONSENT_KEYS.map((key) => (
                <ConsentRow
                  key={key}
                  id={consentId(key)}
                  name={key}
                  label={consentLabel(key, operator)}
                  checked={consents[key]}
                  error={errorFor(consentId(key))}
                  onChange={(checked) =>
                    setConsents((current) => ({ ...current, [key]: checked }))
                  }
                />
              ))}
            </Fieldset>
            <div id="submit-captcha" tabIndex={-1}>
              <Turnstile
                key={generation}
                siteKey={siteKey}
                onToken={(value) => {
                  setToken(value)
                  if (value) setCaptchaFailed(false)
                }}
                onLoadFailed={setCaptchaFailed}
              />
              {errorFor("submit-captcha") && (
                <ErrorMessage id="submit-captcha">
                  {errorFor("submit-captcha") ?? ""}
                </ErrorMessage>
              )}
            </div>
            <UploadFailure
              flow={flow}
              onRetry={(report, failed) => void upload(report, failed)}
              onSkip={(report) => finish(report, true)}
            />
            {/* PLAN: directly above submit */}
            <Note>{m.consent_info()}</Note>
            <div id="submit" tabIndex={-1}>
              {errorFor("submit") && (
                <div className="mb-3">
                  <ErrorMessage id="submit">
                    {errorFor("submit") ?? ""}
                  </ErrorMessage>
                </div>
              )}
              <Button
                type="submit"
                variant="dark"
                className="w-full sm:w-auto sm:min-w-32"
                pending={busy}
                pendingLabel={m.review_submitting()}
                disabled={flow.kind === "upload_failed"}
              >
                {m.review_submit()}
              </Button>
              {/* Mounted early for announcements */}
              <p role="status" className="mt-3 font-semibold text-sm">
                {flow.kind === "uploading"
                  ? m.upload_progress({
                      current: flow.current,
                      total: flow.total,
                      percent: flow.percent,
                    })
                  : ""}
              </p>
            </div>
          </form>
        )}
      </div>
    </>
  )
}

// New tab keeps form state
function PolicyLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener"
      className="font-semibold text-accent underline underline-offset-4 hover:no-underline"
    >
      {label} <span className="whitespace-nowrap">{m.link_new_tab()}</span>
    </a>
  )
}

const POLICY_LINKS = [
  { href: "/privasi", label: m.privacy_link },
  { href: "/pedoman", label: m.guidelines_link },
] as const

export function ConsentHint() {
  return (
    <>
      {m.consent_hint()}
      <span className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
        <span>{m.consent_policies()}</span>
        {POLICY_LINKS.map((link) => (
          <PolicyLink key={link.href} href={link.href} label={link.label()} />
        ))}
      </span>
    </>
  )
}

// Policy before the account exists
function SignInPrivacy() {
  return (
    <p className="flex gap-2 border-line-subtle border-t pt-4 text-ink-soft text-sm leading-relaxed">
      <Lock aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span>
        {m.signin_privacy_note()}{" "}
        <PolicyLink href="/privasi" label={m.privacy_link()} />
      </span>
    </p>
  )
}

type ConsentRowProps = {
  id: string
  name: string
  label: string
  checked: boolean
  error?: string
  onChange: (checked: boolean) => void
}

// Error below, as age box
export function ConsentRow({
  id,
  name,
  label,
  checked,
  error,
  onChange,
}: ConsentRowProps) {
  return (
    <div className={error ? "border-danger border-l-4 pl-4" : undefined}>
      <Checkbox
        id={id}
        name={name}
        aria-describedby={error ? `${id}-error` : undefined}
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
        label={label}
      />
      {error && <ErrorMessage id={id}>{error}</ErrorMessage>}
    </div>
  )
}

function consentLabel(key: ConsentKey, operator: string): string {
  switch (key) {
    case "age_18_plus":
      return m.consent_age()
    case "accurate":
      return m.consent_accurate()
    case "public_issue":
      return m.consent_public_issue()
    case "aggregate_processing":
      return m.consent_aggregate({ operator })
    case "forward_to_agency":
      // PLAN §7: marker goes first
      return `${m.field_optional()} ${m.consent_forward()}`
  }
}

function UploadFailure({
  flow,
  onRetry,
  onSkip,
}: {
  flow: Flow
  onRetry: (report: SubmittedReport, failed: number[]) => void
  onSkip: (report: SubmittedReport) => void
}) {
  if (flow.kind !== "upload_failed") return null
  const names = flow.failed
    .map((position) => memory.files[position]?.name)
    .filter(Boolean)
    .join(", ")
  return (
    <div
      role="alert"
      className="flex flex-col gap-4 border-danger border-l-4 bg-danger-soft p-4 text-danger-ink"
    >
      <p className="font-semibold">{m.upload_failed({ names })}</p>
      <div className="flex flex-wrap gap-3">
        <Button
          variant="dark"
          onClick={() => onRetry(flow.report, flow.failed)}
        >
          {m.upload_retry()}
        </Button>
        <Button variant="secondary" onClick={() => onSkip(flow.report)}>
          {m.upload_skip()}
        </Button>
      </div>
    </div>
  )
}
