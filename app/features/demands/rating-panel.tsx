import { type FormEvent, useEffect, useRef, useState } from "react"
import { Form, useFetcher } from "react-router"
import { Button } from "~/components/ui/button"
import {
  ErrorSummary,
  errorTitle,
  type FieldError,
} from "~/components/ui/error-summary"
import { ErrorMessage, Fieldset, Radio } from "~/components/ui/field"
import { Note } from "~/components/ui/note"
import { SignedInAs } from "~/features/report/sign-in"
import { captchaWait, Turnstile } from "~/features/report/turnstile"
import { m } from "~/paraglide/messages.js"
import {
  IMPORTANCE_ACCOUNT_DAYS,
  IMPORTANCE_MIN_RATERS,
  IMPORTANCE_SCORES,
} from "../../../shared/demands.ts"
import { IMPORTANCE_TEXT } from "./importance-labels"
import type { OwnRating } from "./rating.server"
import { checkRating, type RatingErrorKey } from "./rating-form"

export type RatingActionData =
  | { errors: RatingErrorKey[] }
  | {
      error: "captcha_failed" | "not_found" | "closed" | "sign_in_required"
    }

const IDS = {
  score: "importance-score-5",
  visibility: "importance-anonymous",
  captcha: "importance-captcha",
  submit: "importance-submit",
} as const

const FIELD_TEXT: Record<RatingErrorKey, () => string> = {
  score: m.error_importance_score,
  visibility: m.error_importance_visibility,
}

function fieldErrors(keys: readonly RatingErrorKey[]): FieldError[] {
  return keys.map((key) => ({ fieldId: IDS[key], message: FIELD_TEXT[key]() }))
}

function failureError(error: string): FieldError {
  if (error === "captcha_failed") {
    return { fieldId: IDS.captcha, message: m.error_captcha_failed() }
  }
  return {
    fieldId: IDS.submit,
    message:
      error === "closed"
        ? m.demand_importance_closed()
        : m.error_importance_unavailable(),
  }
}

/** Signed-in form, needs JS. */
export function RatingForm({
  email,
  name,
  own,
  siteKey,
  pageTitle,
  onSessionLost,
}: {
  email: string
  // Shown only when chosen
  name: string
  own: OwnRating | null
  siteKey: string
  pageTitle: string
  onSessionLost: () => void
}) {
  const fetcher = useFetcher<RatingActionData>()
  const [token, setToken] = useState<string | null>(null)
  const [captchaFailed, setCaptchaFailed] = useState(false)
  const [generation, setGeneration] = useState(0)
  const [errors, setErrors] = useState<FieldError[]>([])
  // One key per draft
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
      setErrors([failureError(data.error)])
      if (data.error === "sign_in_required") onSessionLost()
    }
  })

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const checked = checkRating({
      score: String(form.get("score") ?? ""),
      visibility: String(form.get("visibility") ?? ""),
    })
    const found = checked.ok ? [] : fieldErrors(checked.errors)
    if (!token) {
      found.push({ fieldId: IDS.captcha, message: captchaWait(captchaFailed) })
    }
    setErrors(found)
    if (found.length > 0 || !token) return
    submission.current ??= crypto.randomUUID()
    form.set("intent", "rate")
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
          id="importance-score"
          legend={m.demand_importance_legend()}
          hint={m.demand_importance_hint()}
          requiredMark
          error={errorFor(IDS.score)}
        >
          {IMPORTANCE_SCORES.toReversed().map((score) => (
            <Radio
              key={score}
              id={`importance-score-${score}`}
              name="score"
              value={score}
              defaultChecked={own?.score === score}
              label={`${score} · ${IMPORTANCE_TEXT[score]()}`}
              inline
            />
          ))}
        </Fieldset>
        <Fieldset
          id="importance-visibility"
          legend={m.demand_importance_visibility_legend()}
          requiredMark
          error={errorFor(IDS.visibility)}
        >
          <Radio
            id="importance-anonymous"
            name="visibility"
            value="anonymous"
            // Anonymous unless chosen
            defaultChecked={!own?.showName}
            label={m.demand_importance_anonymous()}
            hint={m.demand_importance_anonymous_hint()}
          />
          <Radio
            id="importance-named"
            name="visibility"
            value="named"
            defaultChecked={Boolean(own?.showName)}
            label={m.demand_importance_named({ name })}
            hint={m.demand_importance_named_hint()}
          />
        </Fieldset>
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
        <Note>
          {m.demand_importance_rules({
            min: IMPORTANCE_MIN_RATERS,
            days: IMPORTANCE_ACCOUNT_DAYS,
          })}
        </Note>
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
            pendingLabel={m.demand_importance_submitting()}
          >
            {own ? m.demand_importance_update() : m.demand_importance_submit()}
          </Button>
        </div>
      </form>
    </>
  )
}

/** Plain POST, works without JS. */
export function WithdrawRating() {
  return (
    <Form method="post" className="mt-8 border-line-subtle border-t pt-5">
      <p className="text-ink-soft text-sm">
        {m.demand_importance_withdraw_lead()}
      </p>
      <Button
        type="submit"
        name="intent"
        value="withdraw"
        variant="secondary"
        className="mt-3"
      >
        {m.demand_importance_withdraw()}
      </Button>
    </Form>
  )
}
