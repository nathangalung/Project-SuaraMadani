import { ArrowLeft } from "lucide-react"
import {
  type ClipboardEvent,
  type FormEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react"
import { Button } from "~/components/ui/button"
import {
  ErrorSummary,
  type FieldError,
  untouched,
} from "~/components/ui/error-summary"
import {
  Checkbox,
  controlProps,
  describedBy,
  ErrorMessage,
  Field,
  TextInput,
} from "~/components/ui/field"
import { Note } from "~/components/ui/note"
import { m } from "~/paraglide/messages.js"
import { identifierKind, normalizePhone } from "../../../shared/phone.ts"
import type { OtpChannel } from "../../../shared/whatsapp.ts"
import {
  type AccountRequest,
  checkNew,
  codeStatus,
  isEmail,
  lookup,
  requestCode,
  type SendRefusal,
  verifyCode,
} from "./auth-client"
import {
  CHANNEL_GROUP_ID,
  ChannelChoice,
  type ChannelOptions,
  channelFocusId,
  openChannels,
} from "./channel-choice"
import { focusById, useOnChange } from "./focus"
import { useHydrated } from "./hydrated"
import { captchaWait, Turnstile } from "./turnstile"

// Staff finish sign-in there
const TWO_FACTOR_PATH = "/masuk/dua-langkah"
const CODE_LENGTH = 6
// Client timer, Turnstile per send
export const RESEND_SECONDS = 60
const SPAM_HINT_AFTER = 3

const IDS = {
  identifier: "signin-identifier",
  name: "signin-name",
  email: "signin-email",
  phone: "signin-phone",
  age: "signin-age",
  captcha: "signin-captcha",
  code: "signin-code",
  resend: "signin-resend",
  channelBack: "signin-channel-back",
  next: "signin-next",
} as const

type VerifyResult = Awaited<ReturnType<typeof verifyCode>>

export function sendMessage(result: SendRefusal): string {
  if (result === "captcha") return m.error_captcha_failed()
  if (result === "rate_limited") return m.error_code_rate_limited()
  if (result === "whatsapp_unavailable") return m.error_whatsapp_unavailable()
  if (result === "taken") return m.error_email_taken()
  if (result === "pending") return m.error_identifiers_pending()
  if (result === "missing") return m.error_account_missing()
  return m.error_code_send_failed()
}

export function verifyMessage(
  result: Exclude<VerifyResult, "ok" | "two_factor">,
): string {
  if (result === "age") return m.error_consent_age_required()
  if (result === "failed") return m.error_code_send_failed()
  if (result === "rate_limited") return m.error_code_rate_limited()
  if (result === "taken") return m.error_email_taken()
  return m.error_code_wrong()
}

type SignUpInput = {
  name: string
  email: string
  phone: string
  age: boolean
}

// Mirrors server cleanName
const NAME_TEXT = /^[\p{L}\p{M}' .,-]{2,100}$/u

/** Daftar checks, in field order. */
export function signUpProblems(input: SignUpInput): FieldError[] {
  const found: FieldError[] = []
  const name = input.name.trim().replace(/\s+/g, " ")
  if (name === "") {
    found.push({ fieldId: IDS.name, message: m.error_name_required() })
  } else if (!NAME_TEXT.test(name)) {
    found.push({ fieldId: IDS.name, message: m.error_name_format() })
  }
  if (!isEmail(input.email.trim())) {
    found.push({ fieldId: IDS.email, message: m.error_email_format() })
  }
  if (input.phone.trim() === "") {
    found.push({ fieldId: IDS.phone, message: m.error_phone_required() })
  } else if (!normalizePhone(input.phone)) {
    found.push({ fieldId: IDS.phone, message: m.error_phone_format() })
  }
  if (!input.age) {
    found.push({ fieldId: IDS.age, message: m.error_consent_age_required() })
  }
  return found
}

/** Masuk: email or mobile. */
export function signInProblem(identifier: string): string | undefined {
  if (identifier.trim() === "") return m.error_identifier_required()
  return identifierKind(identifier) ? undefined : m.error_identifier_format()
}

type LookupMiss = Exclude<Awaited<ReturnType<typeof lookup>>, { kind: "found" }>

/** Masuk: why no channel step. */
export function lookupError(found: LookupMiss, identifier: string): FieldError {
  const message =
    found.kind === "missing"
      ? m.error_account_missing()
      : found.kind === "unproven"
        ? isEmail(identifier)
          ? m.error_email_unproven()
          : m.error_phone_unproven()
        : found.kind === "invalid"
          ? m.error_identifier_format()
          : found.kind === "rate_limited"
            ? m.error_code_rate_limited()
            : m.error_account_check_failed()
  return { fieldId: IDS.identifier, message }
}

/** Daftar: no field is wrong. */
export function checkNewError(found: {
  kind: "failed" | "rate_limited"
}): FieldError {
  return {
    fieldId: IDS.next,
    message:
      found.kind === "rate_limited"
        ? m.error_code_rate_limited()
        : m.error_account_check_failed(),
  }
}

function messageFor(errors: FieldError[], id: string) {
  return errors.find((error) => error.fieldId === id)?.message
}

/** Digits only, first six. */
export function codeDigits(text: string): string {
  return text.replace(/\D/g, "").slice(0, CODE_LENGTH)
}

type CodeInput = {
  value: string
  form: { requestSubmit: () => void } | null
}

/** Fills digits, whole code submits. */
export function pasteCode(input: CodeInput, text: string): void {
  input.value = codeDigits(text)
  // Replaces a full field too
  if (text.replace(/\D/g, "").length === CODE_LENGTH) {
    input.form?.requestSubmit()
  }
}

/** Autofill, not typing. */
export function insertedWholeCode(before: string, after: string): boolean {
  return (
    codeDigits(after).length === CODE_LENGTH &&
    after.length - before.length >= CODE_LENGTH
  )
}

/** Seconds as m:ss. */
export function clockText(seconds: number): string {
  const rest = Math.max(0, seconds)
  return `${Math.floor(rest / 60)}:${String(rest % 60).padStart(2, "0")}`
}

const CODE_INPUT =
  "h-14 w-full rounded-md border-2 border-line bg-surface-raised px-4 text-center font-bold text-2xl text-ink tabular-nums tracking-[0.5em] transition-colors focus:border-brand aria-[invalid=true]:border-danger"

type CodeFormProps = {
  channel: OtpChannel
  // Masked destination
  to: string
  errors: FieldError[]
  busy: boolean
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  // Typing clears the code error
  onEdit?: (event: FormEvent<HTMLFormElement>) => void
  onBack: () => void
  // WhatsApp failed, offer email
  notice?: ReactNode
  // Resend control and widget
  resend?: ReactNode
  // Page title, after the summary
  heading?: ReactNode
  primary?: boolean
}

function BackButton({
  id,
  onClick,
  children,
}: {
  id?: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      id={id}
      type="button"
      onClick={onClick}
      className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 text-ink-soft text-sm hover:text-ink hover:underline hover:underline-offset-4"
    >
      <ArrowLeft aria-hidden="true" className="size-4" />
      {children}
    </button>
  )
}

const EMAIL_SLOT = "\u0000"

/** Email never splits at hyphens. */
export function SignedInAs({ email }: { email: string }) {
  const [before, after] = m
    .signin_signed_in({ email: EMAIL_SLOT })
    .split(EMAIL_SLOT)
  return (
    <>
      {before}
      <span className="inline-block max-w-full break-all">
        {email}
        {after}
      </span>
    </>
  )
}

export function CodeForm({
  channel,
  to,
  errors,
  busy,
  onSubmit,
  onEdit,
  onBack,
  notice,
  resend,
  heading,
  primary = false,
}: CodeFormProps) {
  const last = useRef("")
  const hint =
    channel === "whatsapp"
      ? m.signin_code_hint_whatsapp({ to })
      : m.signin_code_hint({ to })
  const error = messageFor(errors, IDS.code)
  // One event, whole code: submit
  const submitIfWhole = (input: HTMLInputElement, before: string) => {
    last.current = input.value
    if (insertedWholeCode(before, input.value)) input.form?.requestSubmit()
  }
  const paste = (event: ClipboardEvent<HTMLInputElement>) => {
    // "123 456" must not truncate
    event.preventDefault()
    const input = event.currentTarget
    pasteCode(input, event.clipboardData.getData("text"))
    last.current = input.value
  }
  return (
    <div className="flex flex-col gap-4">
      <div>
        <BackButton onClick={onBack}>{m.signin_change_channel()}</BackButton>
      </div>
      <form
        noValidate
        onSubmit={onSubmit}
        onChange={onEdit}
        className="flex flex-col gap-5"
      >
        <ErrorSummary errors={errors} attempt={errors} />
        {heading}
        {notice}
        {/* Pasted "123 456" must fit */}
        <Field
          id={IDS.code}
          label={m.signin_code_label()}
          hint={hint}
          error={error}
        >
          <input
            name="code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            placeholder="••••••"
            spellCheck={false}
            required
            className={CODE_INPUT}
            onPaste={paste}
            onInput={(event) =>
              submitIfWhole(event.currentTarget, last.current)
            }
            {...controlProps(IDS.code, hint, error)}
          />
        </Field>
        <Button
          type="submit"
          variant={primary ? "primary" : "dark"}
          className="w-full"
          pending={busy}
          pendingLabel={m.code_checking()}
        >
          {m.signin_submit()}
        </Button>
      </form>
      {resend}
    </div>
  )
}

type ResendProps = {
  remaining: number
  count: number
  sending: boolean
  error?: string
  onResend: () => void
  widget: ReactNode
}

// Waits, then asks Turnstile
export function ResendCode({
  remaining,
  count,
  sending,
  error,
  onResend,
  widget,
}: ResendProps) {
  const waiting = remaining > 0 || sending
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <button
        id={IDS.resend}
        type="button"
        aria-disabled={waiting || undefined}
        onClick={() => {
          if (!waiting) onResend()
        }}
        className="min-h-11 font-semibold text-accent text-sm hover:underline hover:underline-offset-4 aria-disabled:cursor-default aria-disabled:text-ink-muted aria-disabled:no-underline"
      >
        {remaining > 0
          ? m.signin_resend_wait({ time: clockText(remaining) })
          : m.signin_resend()}
      </button>
      {error && <ErrorMessage id={IDS.resend}>{error}</ErrorMessage>}
      {widget}
      {count >= SPAM_HINT_AFTER && (
        <p className="font-ui text-ink-muted text-sm">
          {m.signin_resend_spam()}
        </p>
      )}
    </div>
  )
}

/** Whole seconds until resend. */
export function secondsLeft(since: number | null, now: number): number {
  if (since === null) return 0
  // Stale clock never overshoots
  const elapsed = Math.max(0, now - since)
  return Math.max(0, Math.ceil(RESEND_SECONDS - elapsed / 1000))
}

/** Ticks once a second. */
function useCountdown(since: number | null): number {
  const [now, setNow] = useState(() => Date.now())
  const left = secondsLeft(since, now)
  useEffect(() => {
    if (since === null || left <= 0) return
    const timer = window.setTimeout(() => setNow(Date.now()), 1000)
    return () => window.clearTimeout(timer)
  }, [since, left])
  return Math.max(0, left)
}

type Mode = "sign-in" | "sign-up"
type Phase = "start" | "channel" | "code"
type Values = { identifier: string; name: string; email: string; phone: string }

const EMPTY: Values = { identifier: "", name: "", email: "", phone: "" }
// WhatsApp delivery, about one minute
const STATUS_POLL_MS = 3000
const STATUS_POLLS = 20

const MODES: { value: Mode; label: () => string }[] = [
  { value: "sign-in", label: m.signin_tab_in },
  { value: "sign-up", label: m.signin_tab_up },
]

function ModeSwitch({
  mode,
  onChange,
}: {
  mode: Mode
  onChange: (mode: Mode) => void
}) {
  return (
    <fieldset className="grid min-w-0 grid-cols-2 gap-1 rounded-full bg-chip p-1">
      <legend className="sr-only">{m.signin_tabs_label()}</legend>
      {MODES.map((item) => (
        <button
          key={item.value}
          type="button"
          aria-pressed={mode === item.value}
          onClick={() => onChange(item.value)}
          className="min-h-11 cursor-pointer rounded-full border border-transparent font-semibold text-ink-muted transition-[background-color,border-color,color] duration-150 hover:text-ink aria-pressed:border-line-subtle aria-pressed:bg-surface-raised aria-pressed:text-ink motion-reduce:transition-none"
        >
          {item.label()}
        </button>
      ))}
    </fieldset>
  )
}

/** Email fallback only where open. */
export function whatsappFailedNotice(options: ChannelOptions | null): {
  text: string
  email: boolean
} {
  const email = options ? openChannels(options).includes("email") : false
  return email
    ? { text: m.signin_whatsapp_failed(), email }
    : { text: m.signin_whatsapp_failed_retry(), email }
}

/** One open option is preselected. */
function onlyOpen(options: ChannelOptions): OtpChannel | undefined {
  const open = openChannels(options)
  return open.length === 1 ? open[0] : undefined
}

const formData = (form: HTMLFormElement | null) =>
  form ? new FormData(form) : null

const field = (data: FormData, name: string) =>
  String(data.get(name) ?? "").trim()

/** Carries typed values across modes. */
export function valuesFrom(
  data: FormData | null,
  mode: Mode,
  now: Values,
  taken: "email" | "phone" | null = null,
): Values {
  if (!data) return now
  if (mode === "sign-up") {
    const email = field(data, "email")
    const phone = field(data, "phone")
    // The registered one signs in
    const identifier = taken === "phone" ? phone : email || phone
    return {
      ...now,
      identifier: identifier || now.identifier,
      name: field(data, "name"),
      email,
      phone,
    }
  }
  const identifier = field(data, "identifier")
  const kind = identifierKind(identifier)?.kind
  return {
    ...now,
    identifier,
    email: kind === "email" ? identifier : now.email,
    phone: kind === "phone" ? identifier : now.phone,
  }
}

// Identifier-first, email or WhatsApp
export function SignIn({
  siteKey,
  onSignedIn,
  heading,
  intro = m.signin_intro(),
  primary = false,
  initialMode = "sign-in",
}: {
  siteKey: string
  onSignedIn: () => void
  // Own H1 per phase
  heading?: {
    start: ReactNode
    channel: ReactNode
    code: (channel: OtpChannel) => ReactNode
  }
  // Page states its purpose
  intro?: string
  // Mockup blue full-width submit
  primary?: boolean
  initialMode?: Mode
}) {
  const hydrated = useHydrated()
  const startForm = useRef<HTMLFormElement>(null)
  const [mode, setMode] = useState<Mode>(initialMode)
  const [phase, setPhase] = useState<Phase>("start")
  const [values, setValues] = useState<Values>(EMPTY)
  const [account, setAccount] = useState<AccountRequest | null>(null)
  const [masked, setMasked] = useState<ChannelOptions | null>(null)
  const [taken, setTaken] = useState<"email" | "phone" | null>(null)
  const [channel, setChannel] = useState<OtpChannel>()
  const [to, setTo] = useState("")
  const [statusId, setStatusId] = useState<string | null>(null)
  const [whatsappFailed, setWhatsappFailed] = useState(false)
  const [ageChecked, setAgeChecked] = useState(false)
  const [token, setToken] = useState<string | null>(null)
  const [captchaFailed, setCaptchaFailed] = useState(false)
  const [generation, setGeneration] = useState(0)
  const [errors, setErrors] = useState<FieldError[]>([])
  // Edited field drops its red
  const clearEdited = (event: FormEvent<HTMLFormElement>) => {
    const { target } = event
    setErrors((current) => untouched(current, (e) => e.fieldId, target))
  }
  const [busy, setBusy] = useState(false)
  const [sentAt, setSentAt] = useState<number | null>(null)
  const [resends, setResends] = useState(0)
  const [resending, setResending] = useState(false)
  const [resendError, setResendError] = useState<string>()
  const [announce, setAnnounce] = useState("")
  const remaining = useCountdown(sentAt)

  // Swapped form loses focus
  useOnChange(phase, () => {
    const target = {
      start: mode === "sign-up" ? IDS.name : IDS.identifier,
      // Disabled radios take no focus
      channel: masked
        ? (channelFocusId(masked, channel) ?? IDS.channelBack)
        : IDS.channelBack,
      code: IDS.code,
    }[phase]
    focusById(document, target)
  })
  // Announced once, at zero
  useOnChange(remaining === 0, () => {
    if (remaining === 0 && phase === "code") {
      setAnnounce(m.signin_resend_ready())
    }
  })
  // No silent WhatsApp failure
  useEffect(() => {
    if (phase !== "code" || channel !== "whatsapp" || !statusId) return
    let polls = 0
    const timer = window.setInterval(async () => {
      polls += 1
      const status = await codeStatus(statusId, fetch)
      // Still unsent after a minute
      const late = polls >= STATUS_POLLS && status !== "sent"
      if (status === "failed" || late) {
        setWhatsappFailed(true)
        setAnnounce(whatsappFailedNotice(masked).text)
      }
      if (status === "failed" || status === "sent" || late) {
        window.clearInterval(timer)
      }
    }, STATUS_POLL_MS)
    return () => window.clearInterval(timer)
  }, [phase, channel, statusId, masked])

  const toStart = (found: FieldError[] = []) => {
    setErrors(found)
    setResending(false)
    setResendError(undefined)
    setPhase("start")
  }

  const switchMode = (next: Mode) => {
    if (next === mode) return
    setValues((now) =>
      valuesFrom(formData(startForm.current), mode, now, taken),
    )
    setErrors([])
    setMode(next)
  }

  const next = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy) return
    const data = new FormData(event.currentTarget)
    setValues((now) => valuesFrom(data, mode, now))
    if (mode === "sign-in") {
      const identifier = field(data, "identifier")
      const problem = signInProblem(identifier)
      if (problem) {
        setErrors([{ fieldId: IDS.identifier, message: problem }])
        return
      }
      setBusy(true)
      const found = await lookup(identifier, fetch)
      setBusy(false)
      if (found.kind === "found") {
        setAccount({ mode: "sign-in", identifier })
        setMasked(found)
        setChannel(onlyOpen(found))
        setErrors([])
        setPhase("channel")
        return
      }
      setErrors([lookupError(found, identifier)])
      return
    }
    const fields = {
      name: field(data, "name"),
      email: field(data, "email"),
      phone: field(data, "phone"),
    }
    const age = data.get("age") === "yes"
    const problems = signUpProblems({ ...fields, age })
    setErrors(problems)
    if (problems.length > 0) return
    setBusy(true)
    const found = await checkNew(fields, fetch)
    setBusy(false)
    setTaken(found.kind === "taken" ? found.field : null)
    if (found.kind === "free") {
      setAccount({ mode: "sign-up", ...fields })
      setMasked(found)
      setAgeChecked(age)
      setChannel(onlyOpen(found))
      setPhase("channel")
      return
    }
    if (found.kind === "pending") {
      setErrors([
        { fieldId: IDS.email, message: m.error_identifiers_pending() },
      ])
      return
    }
    if (found.kind === "taken") {
      setErrors([
        found.field === "email"
          ? { fieldId: IDS.email, message: m.error_email_taken() }
          : { fieldId: IDS.phone, message: m.error_phone_taken() },
      ])
      return
    }
    if (found.kind === "invalid") {
      const id = {
        name: IDS.name,
        email: IDS.email,
        phone: IDS.phone,
      }[found.field]
      const message = {
        name: m.error_name_format(),
        email: m.error_email_format(),
        phone: m.error_phone_format(),
      }[found.field]
      setErrors([{ fieldId: id, message }])
      return
    }
    setErrors([checkNewError(found)])
  }

  const send = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy || !account) return
    const found: FieldError[] = []
    if (!channel) {
      found.push({
        fieldId: CHANNEL_GROUP_ID,
        message: m.error_otp_channel_required(),
      })
    }
    if (!token) {
      found.push({ fieldId: IDS.captcha, message: captchaWait(captchaFailed) })
    }
    setErrors(found)
    if (!channel || !token) return
    setBusy(true)
    const result = await requestCode(account, channel, token, fetch)
    setBusy(false)
    // Tokens are single use
    setGeneration((value) => value + 1)
    if (result.ok) {
      setTo(result.to)
      setStatusId(result.statusId)
      setWhatsappFailed(false)
      setSentAt(Date.now())
      setResends(0)
      setAnnounce(m.signin_code_sent({ to: result.to }))
      setPhase("code")
      return
    }
    if (result.reason === "whatsapp_unavailable") {
      const down = masked && { ...masked, whatsappReady: false }
      setMasked(down)
      setChannel(down ? onlyOpen(down) : undefined)
      setErrors([
        { fieldId: CHANNEL_GROUP_ID, message: sendMessage(result.reason) },
      ])
      return
    }
    if (
      result.reason === "taken" ||
      result.reason === "pending" ||
      result.reason === "missing"
    ) {
      toStart([
        {
          fieldId: account.mode === "sign-up" ? IDS.email : IDS.identifier,
          message: sendMessage(result.reason),
        },
      ])
      return
    }
    setErrors([{ fieldId: IDS.captcha, message: sendMessage(result.reason) }])
  }

  // Fresh token, then send
  const resendWith = async (fresh: string | null) => {
    if (!fresh || !resending || !account || !channel) return
    const result = await requestCode(account, channel, fresh, fetch)
    setResending(false)
    setGeneration((value) => value + 1)
    if (result.ok) {
      setStatusId(result.statusId)
      setWhatsappFailed(false)
      setSentAt(Date.now())
      setResends((value) => value + 1)
      setResendError(undefined)
      setAnnounce(m.signin_resend_sent({ to: result.to }))
      return
    }
    setResendError(sendMessage(result.reason))
    setAnnounce(sendMessage(result.reason))
  }

  const verify = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy || !account || !channel) return
    const otp = String(
      new FormData(event.currentTarget).get("code") ?? "",
    ).replace(/\s/g, "")
    if (!/^\d{6}$/.test(otp)) {
      setErrors([{ fieldId: IDS.code, message: m.error_code_format() }])
      return
    }
    setBusy(true)
    const result = await verifyCode(account, channel, otp, ageChecked, fetch)
    setBusy(false)
    if (result === "ok") {
      setErrors([])
      onSignedIn()
      return
    }
    if (result === "two_factor") {
      window.location.assign(TWO_FACTOR_PATH)
      return
    }
    if (result === "taken") {
      toStart([{ fieldId: IDS.email, message: verifyMessage(result) }])
      return
    }
    setErrors([{ fieldId: IDS.code, message: verifyMessage(result) }])
  }

  const useEmail = () => {
    setChannel("email")
    setWhatsappFailed(false)
    setResending(false)
    setErrors([])
    setPhase("channel")
  }

  const failed = whatsappFailedNotice(masked)
  const captchaError = messageFor(errors, IDS.captcha)
  const ageError = messageFor(errors, IDS.age)
  return (
    <div className="flex flex-col gap-6">
      <p role="status" className="sr-only">
        {phase === "code" ? announce : ""}
      </p>
      {phase === "code" && channel ? (
        <CodeForm
          channel={channel}
          to={to}
          errors={errors}
          busy={busy}
          onSubmit={verify}
          onEdit={clearEdited}
          heading={heading?.code(channel)}
          primary={primary}
          onBack={() => {
            setErrors([])
            setResending(false)
            setResendError(undefined)
            setPhase("channel")
          }}
          notice={
            whatsappFailed && (
              <Note tone="danger">
                <p>{failed.text}</p>
                {failed.email ? (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="mt-3"
                    onClick={useEmail}
                  >
                    {m.signin_use_email()}
                  </Button>
                ) : null}
              </Note>
            )
          }
          resend={
            <ResendCode
              remaining={remaining}
              count={resends}
              sending={resending}
              error={resendError}
              onResend={() => {
                setResendError(undefined)
                setResending(true)
              }}
              widget={
                resending && (
                  <Turnstile
                    key={generation}
                    siteKey={siteKey}
                    onToken={(value) => void resendWith(value)}
                    onLoadFailed={(failed) => {
                      if (!failed) return
                      setResending(false)
                      setResendError(captchaWait(true))
                    }}
                  />
                )
              }
            />
          }
        />
      ) : phase === "channel" && masked ? (
        <div className="flex flex-col gap-4">
          <div>
            <BackButton id={IDS.channelBack} onClick={() => toStart()}>
              {m.signin_back()}
            </BackButton>
          </div>
          <form
            noValidate
            onSubmit={send}
            onChange={clearEdited}
            className="flex flex-col gap-5"
          >
            <ErrorSummary errors={errors} attempt={errors} />
            {heading?.channel}
            <ChannelChoice
              {...masked}
              value={channel}
              onChange={setChannel}
              error={messageFor(errors, CHANNEL_GROUP_ID)}
              legendHidden={Boolean(heading)}
            />
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
              {captchaError && (
                <ErrorMessage id={IDS.captcha}>{captchaError}</ErrorMessage>
              )}
            </div>
            <Button
              type="submit"
              variant={primary ? "primary" : "dark"}
              className={primary ? "w-full" : "w-full sm:w-auto"}
              pending={busy}
              pendingLabel={m.signin_sending()}
            >
              {m.signin_send()}
            </Button>
          </form>
        </div>
      ) : (
        <form ref={startForm} noValidate onSubmit={next} onChange={clearEdited}>
          {/* Server HTML must not GET */}
          <fieldset
            disabled={!hydrated}
            className="flex min-w-0 flex-col gap-5"
          >
            <ErrorSummary errors={errors} attempt={errors} />
            {heading?.start}
            <ModeSwitch mode={mode} onChange={switchMode} />
            <p className="leading-relaxed">
              {mode === "sign-in" ? intro : m.signin_up_intro()}
            </p>
            {mode === "sign-in" ? (
              <TextInput
                key="identifier"
                id={IDS.identifier}
                name="identifier"
                autoComplete="username"
                spellCheck={false}
                label={m.signin_identifier_label()}
                hint={m.signin_identifier_hint()}
                error={messageFor(errors, IDS.identifier)}
                defaultValue={values.identifier}
                requiredMark
              />
            ) : (
              <>
                <TextInput
                  id={IDS.name}
                  name="name"
                  autoComplete="name"
                  label={m.signin_name_label()}
                  hint={m.signin_name_hint()}
                  error={messageFor(errors, IDS.name)}
                  defaultValue={values.name}
                  requiredMark
                />
                <TextInput
                  id={IDS.email}
                  name="email"
                  type="email"
                  autoComplete="email"
                  spellCheck={false}
                  label={m.signin_email_label()}
                  error={messageFor(errors, IDS.email)}
                  defaultValue={values.email}
                  requiredMark
                />
                <TextInput
                  id={IDS.phone}
                  name="phone"
                  type="tel"
                  prefix="+62"
                  inputMode="tel"
                  autoComplete="tel"
                  label={m.signin_phone_label()}
                  hint={m.signin_phone_hint()}
                  error={messageFor(errors, IDS.phone)}
                  defaultValue={values.phone.replace(/^\+62/, "")}
                  requiredMark
                />
                <div>
                  <Checkbox
                    id={IDS.age}
                    name="age"
                    value="yes"
                    label={m.signin_age()}
                    hint={m.signin_age_hint()}
                    defaultChecked={ageChecked}
                    aria-describedby={describedBy(
                      IDS.age,
                      true,
                      Boolean(ageError),
                    )}
                    requiredMark
                  />
                  {ageError && (
                    <ErrorMessage id={IDS.age}>{ageError}</ErrorMessage>
                  )}
                </div>
              </>
            )}
            <p className="font-ui text-ink-muted text-sm">
              {m.field_required_note()}
            </p>
            <div>
              <Button
                id={IDS.next}
                type="submit"
                variant={primary ? "primary" : "dark"}
                className={primary ? "w-full" : "w-full sm:w-auto"}
                pending={busy}
                pendingLabel={m.signin_checking()}
              >
                {m.signin_next()}
              </Button>
            </div>
          </fieldset>
        </form>
      )}
    </div>
  )
}
