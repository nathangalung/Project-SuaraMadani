import { type FormEvent, useEffect, useRef, useState } from "react"
import { useFetcher } from "react-router"
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
  Radio,
  Textarea,
} from "~/components/ui/field"
import { Note } from "~/components/ui/note"
import { SignedInAs } from "~/features/report/sign-in"
import { captchaWait, Turnstile } from "~/features/report/turnstile"
import { m } from "~/paraglide/messages.js"
import {
  COMPLAINT_LENGTHS,
  COMPLAINT_REASONS,
  COMPLAINT_SLA_DAYS,
  type ComplaintSubjectKind,
  DAILY_COMPLAINTS,
  partsFor,
} from "../../../shared/complaints.ts"
import { formatRange } from "../../../shared/format.ts"
import {
  COMPLAINT_REASON_TEXT,
  complaintPartText,
} from "../moderation/complaint-labels.ts"
import { type ComplaintErrorKey, checkComplaint } from "./complaint-form.ts"

export type ComplaintActionData =
  | { errors: ComplaintErrorKey[] }
  | {
      error:
        | "captcha_failed"
        | "quota_exceeded"
        | "not_found"
        | "sign_in_required"
    }

const L = COMPLAINT_LENGTHS.explanation

const IDS = {
  reason: `reason-${COMPLAINT_REASONS[0]}`,
  // Both part lists start here
  part: "part-title_summary",
  explanation: "complaint-explanation",
  good_faith: "complaint-good-faith",
  captcha: "complaint-captcha",
  submit: "complaint-submit",
} as const

const FIELD_TEXT: Record<ComplaintErrorKey, () => string> = {
  reason: m.error_complaint_reason,
  part: m.error_complaint_part,
  explanation: () => m.error_complaint_explanation(formatRange(L)),
  good_faith: m.error_complaint_good_faith,
}

function fieldErrors(keys: readonly ComplaintErrorKey[]): FieldError[] {
  return keys.map((key) => ({ fieldId: IDS[key], message: FIELD_TEXT[key]() }))
}

function failureError(error: string, kind: ComplaintSubjectKind): FieldError {
  if (error === "captcha_failed") {
    return { fieldId: IDS.captcha, message: m.error_captcha_failed() }
  }
  if (error === "quota_exceeded") {
    return {
      fieldId: IDS.submit,
      message: m.error_complaint_quota({ n: DAILY_COMPLAINTS }),
    }
  }
  return {
    fieldId: IDS.submit,
    message:
      kind === "issue"
        ? m.error_complaint_unavailable()
        : m.error_complaint_unavailable_demand(),
  }
}

/** Signed-in form, needs JS. */
export function ComplaintForm({
  email,
  siteKey,
  pageTitle,
  onSessionLost,
  kind = "issue",
}: {
  email: string
  siteKey: string
  pageTitle: string
  onSessionLost: () => void
  kind?: ComplaintSubjectKind
}) {
  const parts = partsFor(kind)
  const fetcher = useFetcher<ComplaintActionData>()
  const [token, setToken] = useState<string | null>(null)
  const [captchaFailed, setCaptchaFailed] = useState(false)
  const [generation, setGeneration] = useState(0)
  const [errors, setErrors] = useState<FieldError[]>([])
  // One key per complaint draft
  const submission = useRef<string | null>(null)
  const handled = useRef<unknown>(null)

  useEffect(() => {
    const data = fetcher.data
    if (fetcher.state !== "idle" || !data || handled.current === data) return
    handled.current = data
    // Token is spent either way
    setGeneration((value) => value + 1)
    if ("errors" in data) {
      setErrors(fieldErrors(data.errors))
    } else {
      setErrors([failureError(data.error, kind)])
      if (data.error === "sign_in_required") onSessionLost()
    }
  })

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const checked = checkComplaint(
      {
        reason: String(form.get("reason") ?? ""),
        part: String(form.get("part") ?? ""),
        explanation: String(form.get("explanation") ?? ""),
        goodFaith: form.get("goodFaith") === "yes",
      },
      parts,
    )
    const found = "errors" in checked ? fieldErrors(checked.errors) : []
    if (!token) {
      found.push({ fieldId: IDS.captcha, message: captchaWait(captchaFailed) })
    }
    setErrors(found)
    if (found.length > 0 || !token) return
    submission.current ??= crypto.randomUUID()
    form.set("submissionId", submission.current)
    form.set("turnstileToken", token)
    fetcher.submit(form, { method: "post" })
  }

  const errorFor = (id: string) => errors.find((e) => e.fieldId === id)?.message
  return (
    <>
      <title>{errorTitle(pageTitle, errors.length > 0)}</title>
      <ErrorSummary errors={errors} attempt={errors} />
      <form noValidate onSubmit={submit} className="flex flex-col gap-7">
        <p className="font-ui text-ink-muted text-sm">
          <SignedInAs email={email} />
        </p>
        <Fieldset
          id="complaint-reason"
          legend={m.complaint_reason_legend()}
          requiredMark
          error={errorFor(IDS.reason)}
          optionsClassName="grid gap-x-6 gap-y-1 sm:grid-cols-2"
        >
          {COMPLAINT_REASONS.map((reason) => (
            <Radio
              key={reason}
              id={`reason-${reason}`}
              name="reason"
              value={reason}
              label={COMPLAINT_REASON_TEXT[reason]()}
              inline
            />
          ))}
        </Fieldset>
        <Fieldset
          id="complaint-part"
          legend={m.complaint_part_legend()}
          hint={m.complaint_part_hint()}
          requiredMark
          error={errorFor(IDS.part)}
        >
          {parts.map((part) => (
            <Radio
              key={part}
              id={`part-${part}`}
              name="part"
              value={part}
              label={complaintPartText(part, kind)}
              inline
            />
          ))}
        </Fieldset>
        <Textarea
          id={IDS.explanation}
          name="explanation"
          label={m.complaint_explanation_label()}
          hint={m.complaint_explanation_hint(formatRange(L))}
          requiredMark
          error={errorFor(IDS.explanation)}
          maxLength={L.max}
          rows={6}
        />
        <div>
          <Checkbox
            id={IDS.good_faith}
            name="goodFaith"
            value="yes"
            label={m.complaint_good_faith()}
            aria-invalid={errorFor(IDS.good_faith) ? true : undefined}
          />
          {errorFor(IDS.good_faith) ? (
            <div className="mt-1">
              <ErrorMessage id={IDS.good_faith}>
                {errorFor(IDS.good_faith) ?? ""}
              </ErrorMessage>
            </div>
          ) : null}
        </div>
        <div id={IDS.captcha} tabIndex={-1}>
          <Turnstile
            key={generation}
            siteKey={siteKey}
            onToken={(value) => {
              setToken(value)
              if (value) setCaptchaFailed(false)
            }}
            onLoadFailed={setCaptchaFailed}
          />
          {errorFor(IDS.captcha) ? (
            <ErrorMessage id={IDS.captcha}>
              {errorFor(IDS.captcha) ?? ""}
            </ErrorMessage>
          ) : null}
        </div>
        <Note>{m.complaint_what_next({ days: COMPLAINT_SLA_DAYS })}</Note>
        <div id={IDS.submit} tabIndex={-1}>
          {errorFor(IDS.submit) ? (
            <div className="mb-3">
              <ErrorMessage id={IDS.submit}>
                {errorFor(IDS.submit) ?? ""}
              </ErrorMessage>
            </div>
          ) : null}
          <Button
            type="submit"
            variant="dark"
            className="w-full sm:w-auto sm:min-w-32"
            pending={fetcher.state !== "idle"}
            pendingLabel={m.complaint_submitting()}
          >
            {m.complaint_submit()}
          </Button>
        </div>
      </form>
    </>
  )
}
