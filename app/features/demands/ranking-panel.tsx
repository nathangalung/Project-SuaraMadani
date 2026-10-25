import { type FormEvent, useEffect, useRef, useState } from "react"
import { Form, useFetcher } from "react-router"
import { Button } from "~/components/ui/button"
import {
  ErrorSummary,
  errorTitle,
  type FieldError,
} from "~/components/ui/error-summary"
import { ErrorMessage } from "~/components/ui/field"
import { Note } from "~/components/ui/note"
import { SelectControl } from "~/components/ui/select-control"
import { SignedInAs } from "~/features/report/sign-in"
import { captchaWait, Turnstile } from "~/features/report/turnstile"
import { m } from "~/paraglide/messages.js"
import {
  RANKING_ACCOUNT_DAYS,
  RANKING_MIN_RANKERS,
  RANKING_SIZE,
} from "../../../shared/demands.ts"
import { CATEGORY_TEXT } from "./category-labels"
import { demandPlace } from "./labels"
import type { RankingChoice } from "./ranking.server"
import { checkRanking, RANK_FIELD, type RankingErrorKey } from "./ranking-form"

export type RankingActionData =
  | { errors: RankingErrorKey[] }
  | { error: "captcha_failed" | "not_found" | "sign_in_required" }

const IDS = {
  list: "ranking-list",
  captcha: "ranking-captcha",
  submit: "ranking-submit",
} as const

const FIELD_TEXT: Record<RankingErrorKey, () => string> = {
  empty: m.error_rank_empty,
  duplicate: m.error_rank_duplicate,
}

function fieldErrors(keys: readonly RankingErrorKey[]): FieldError[] {
  return keys.map((key) => ({ fieldId: IDS.list, message: FIELD_TEXT[key]() }))
}

function failureError(error: string): FieldError {
  if (error === "captcha_failed") {
    return { fieldId: IDS.captcha, message: m.error_captcha_failed() }
  }
  return { fieldId: IDS.submit, message: m.error_rank_unavailable() }
}

const POSITIONS = Array.from({ length: RANKING_SIZE }, (_, i) => i + 1)

/** Signed-in form, needs JS. */
export function RankingForm({
  email,
  choices,
  saved,
  siteKey,
  pageTitle,
  onSessionLost,
}: {
  email: string
  choices: RankingChoice[]
  saved: boolean
  siteKey: string
  pageTitle: string
  onSessionLost: () => void
}) {
  const fetcher = useFetcher<RankingActionData>()
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
    const checked = checkRanking(form.entries())
    const found = checked.ok ? [] : fieldErrors(checked.errors)
    if (!token) {
      found.push({ fieldId: IDS.captcha, message: captchaWait(captchaFailed) })
    }
    setErrors(found)
    if (found.length > 0 || !token) return
    submission.current ??= crypto.randomUUID()
    form.set("intent", "rank")
    form.set("submissionId", submission.current)
    form.set("turnstileToken", token)
    fetcher.submit(form, { method: "post" })
  }

  const errorFor = (id: string) => errors.find((e) => e.fieldId === id)?.message
  const listError = errorFor(IDS.list)
  return (
    <>
      <title>{errorTitle(pageTitle, errors.length > 0)}</title>
      <ErrorSummary errors={errors} attempt={errors} />
      <form
        noValidate
        onSubmit={submit}
        onChange={() =>
          setErrors((all) => all.filter((e) => e.fieldId !== IDS.list))
        }
        className="flex flex-col gap-7"
      >
        <p className="font-ui text-ink-muted text-sm">
          <SignedInAs email={email} />
        </p>
        <fieldset
          id={IDS.list}
          aria-describedby={`${IDS.list}-hint${listError ? ` ${IDS.list}-error` : ""}`}
          className="min-w-0"
        >
          <legend className="font-semibold font-ui">
            {m.demand_rank_legend()}
          </legend>
          <p id={`${IDS.list}-hint`} className="mt-1 text-ink-muted text-sm">
            {m.demand_rank_hint()}
          </p>
          {listError ? (
            <div className="mt-2">
              <ErrorMessage id={IDS.list}>{listError}</ErrorMessage>
            </div>
          ) : null}
          <ul className="mt-4 flex flex-col gap-3">
            {choices.map((choice) => (
              <li
                key={choice.code}
                className="grid items-center gap-3 rounded-xl border border-line-subtle bg-surface-raised p-4 sm:grid-cols-[minmax(0,1fr)_11rem]"
              >
                <div className="min-w-0">
                  <p className="font-bold leading-snug">{choice.title}</p>
                  <p className="mt-1 font-ui text-ink-muted text-sm">
                    {[
                      demandPlace({ ...choice, regencyName: null }),
                      choice.category ? CATEGORY_TEXT[choice.category]() : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <SelectControl
                  name={`${RANK_FIELD}${choice.code}`}
                  aria-label={m.demand_rank_select_label({
                    title: choice.title,
                  })}
                  aria-invalid={listError ? true : undefined}
                  defaultValue={choice.position ?? ""}
                >
                  <option value="">{m.demand_rank_none()}</option>
                  {POSITIONS.map((position) => (
                    <option key={position} value={position}>
                      {position}
                    </option>
                  ))}
                </SelectControl>
              </li>
            ))}
          </ul>
        </fieldset>
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
          {m.demand_rank_rules({
            min: RANKING_MIN_RANKERS,
            days: RANKING_ACCOUNT_DAYS,
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
            pendingLabel={m.demand_rank_submitting()}
          >
            {saved ? m.demand_rank_change() : m.demand_rank_submit()}
          </Button>
        </div>
      </form>
    </>
  )
}

/** Plain POST, works without JS. */
export function WithdrawRanking() {
  return (
    <Form method="post" className="mt-8">
      <p className="text-ink-soft text-sm">{m.demand_rank_withdraw_lead()}</p>
      <Button
        type="submit"
        name="intent"
        value="withdraw"
        variant="secondary"
        className="mt-3"
      >
        {m.demand_rank_withdraw()}
      </Button>
    </Form>
  )
}
