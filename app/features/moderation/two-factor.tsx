import { Eye, EyeOff } from "lucide-react"
import { Fragment, type ReactNode } from "react"
import { Form } from "react-router"
import { Button } from "~/components/ui/button"
import { ErrorSummary, type FieldError } from "~/components/ui/error-summary"
import { Checkbox, ErrorMessage, TextInput } from "~/components/ui/field"
import { m } from "~/paraglide/messages.js"
import { useSubmitting } from "./submitting"
import type { TwoFactorActionData, TwoFactorPage } from "./two-factor.server"

const CODE_ID = "totp-code"
const BACKUP_ID = "backup-code"
const SAVED_ID = "totp-saved"
const VERIFY_FORM = "totp-verify"

const ERROR_TEXT = {
  format: m.error_totp_format,
  wrong: m.error_totp_wrong,
  failed: m.error_totp_failed,
  unsaved: m.error_backup_unsaved,
  backup_format: m.error_backup_format,
  backup_wrong: m.error_backup_wrong,
} as const

const ERROR_FIELD = {
  format: CODE_ID,
  wrong: CODE_ID,
  failed: "totp-enroll",
  unsaved: SAVED_ID,
  backup_format: BACKUP_ID,
  backup_wrong: BACKUP_ID,
} as const

function errorsOf(action: TwoFactorActionData | undefined): FieldError[] {
  if (action?.kind !== "error") return []
  return [
    {
      fieldId: ERROR_FIELD[action.error],
      message: ERROR_TEXT[action.error](),
    },
  ]
}

function CodeForm({ uri, errors }: { uri?: string; errors: FieldError[] }) {
  const busy = useSubmitting("verify")
  return (
    <Form
      method="post"
      noValidate
      id={VERIFY_FORM}
      className="flex flex-col gap-6"
    >
      <input type="hidden" name="intent" value="verify" />
      {uri ? <input type="hidden" name="uri" value={uri} /> : null}
      <TextInput
        id={CODE_ID}
        name="code"
        label={m.twofactor_code_label()}
        hint={m.twofactor_code_hint()}
        error={errors.find((e) => e.fieldId === CODE_ID)?.message}
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={7}
        required
      />
      <div>
        <Button
          type="submit"
          className="w-full"
          pending={busy}
          pendingLabel={m.code_checking()}
        >
          {m.twofactor_submit()}
        </Button>
      </div>
    </Form>
  )
}

function BackupForm({ errors }: { errors: FieldError[] }) {
  const busy = useSubmitting("backup")
  const error = errors.find((e) => e.fieldId === BACKUP_ID)?.message
  return (
    <details className="mt-10" open={Boolean(error)}>
      <summary className="cursor-pointer font-semibold text-accent underline underline-offset-4">
        {m.twofactor_backup_use()}
      </summary>
      <Form method="post" noValidate className="mt-6 flex flex-col gap-6">
        <input type="hidden" name="intent" value="backup" />
        <TextInput
          id={BACKUP_ID}
          name="code"
          label={m.twofactor_backup_label()}
          hint={m.twofactor_backup_hint()}
          error={error}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
        />
        <div>
          <Button
            type="submit"
            variant="secondary"
            pending={busy}
            pendingLabel={m.code_checking()}
          >
            {m.twofactor_backup_submit()}
          </Button>
        </div>
      </Form>
    </details>
  )
}

// Groups never split across lines
function KeyGroups({ secret }: { secret: string }) {
  const groups = secret.match(/.{1,4}/g) ?? [secret]
  return (
    <code className={`mt-2 text-lg tracking-widest ${SECRET_BOX}`}>
      {groups.map((group, i) => (
        <Fragment key={secret.slice(0, i * 4 + 4)}>
          {i > 0 ? " " : null}
          <span className="inline-block">{group}</span>
        </Fragment>
      ))}
    </code>
  )
}

/** Native disclosure, eye plus text. */
function Reveal({
  show,
  hide,
  children,
}: {
  show: string
  hide: string
  children: ReactNode
}) {
  return (
    <details className="group">
      <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-[10px] border-2 border-ink px-4 font-semibold text-ink transition-colors hover:bg-ink hover:text-surface-raised [&::-webkit-details-marker]:hidden">
        <Eye aria-hidden="true" className="size-5 group-open:hidden" />
        <EyeOff aria-hidden="true" className="hidden size-5 group-open:block" />
        <span className="group-open:hidden">{show}</span>
        <span className="hidden group-open:inline">{hide}</span>
      </summary>
      <div className="mt-4 flex flex-col gap-4">{children}</div>
    </details>
  )
}

const SECRET_BOX = "block border-2 border-line-subtle bg-surface p-3"

/** Text only, passkey is P5. */
function EnrollKey({
  uri,
  backupCodes,
  saved,
  error,
}: {
  uri: string
  backupCodes: string[]
  saved: boolean
  error?: string
}) {
  const secret = new URL(uri).searchParams.get("secret") ?? ""
  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="totp-key">
        <h2 id="totp-key" className="font-bold text-xl">
          {m.twofactor_key_title()}
        </h2>
        <p className="mt-2 text-ink-soft">{m.twofactor_key_note()}</p>
        <div className="mt-4">
          <Reveal show={m.twofactor_key_show()} hide={m.twofactor_key_hide()}>
            <div>
              <p className="font-semibold">{m.twofactor_secret_label()}</p>
              <KeyGroups secret={secret} />
            </div>
            <div>
              <p className="font-semibold">{m.twofactor_uri_label()}</p>
              <code className={`mt-2 break-all text-sm ${SECRET_BOX}`}>
                {uri}
              </code>
            </div>
          </Reveal>
        </div>
      </section>
      {/* Open, GitHub-style forced acknowledgement */}
      <section aria-labelledby="totp-backup">
        <h2 id="totp-backup" className="font-bold text-xl">
          {m.twofactor_backup_title()}
        </h2>
        <p className="mt-2 text-ink-soft">{m.twofactor_backup_note()}</p>
        {backupCodes.length > 0 ? (
          <ol className="mt-4 grid grid-cols-2 gap-2 border-2 border-line-subtle bg-surface p-3">
            {backupCodes.map((code) => (
              <li key={code}>
                <code>{code}</code>
              </li>
            ))}
          </ol>
        ) : null}
        <div className={error ? "mt-4 border-danger border-l-4 pl-4" : "mt-4"}>
          <Checkbox
            id={SAVED_ID}
            name="saved"
            value="yes"
            form={VERIFY_FORM}
            label={m.twofactor_backup_saved()}
            defaultChecked={saved}
            aria-describedby={error ? `${SAVED_ID}-error` : undefined}
            aria-invalid={error ? true : undefined}
            required
          />
          {error ? <ErrorMessage id={SAVED_ID}>{error}</ErrorMessage> : null}
        </div>
      </section>
      <p>{m.twofactor_confirm_intro()}</p>
    </div>
  )
}

export function TwoFactorSteps({
  page,
  action,
  heading,
}: {
  page: TwoFactorPage
  action: TwoFactorActionData | undefined
  // H1 after the error summary
  heading?: ReactNode
}) {
  const errors = errorsOf(action)
  const signingOut = useSubmitting("sign_out")
  const enrolling = useSubmitting("enroll")
  if (page.mode === "stale") {
    return (
      <Form method="post" noValidate className="flex flex-col gap-6">
        {heading}
        <p>{m.twofactor_stale()}</p>
        <input type="hidden" name="intent" value="sign_out" />
        <div>
          <Button type="submit" variant="secondary" pending={signingOut}>
            {m.twofactor_sign_out()}
          </Button>
        </div>
      </Form>
    )
  }
  if (page.mode === "challenge") {
    return (
      <>
        <ErrorSummary errors={errors} attempt={action} />
        {heading}
        <p className="mt-2 mb-6 text-ink-muted">
          {m.twofactor_challenge_intro()}
        </p>
        <CodeForm errors={errors} />
        <BackupForm errors={errors} />
      </>
    )
  }
  const uri =
    action?.kind === "enrolled"
      ? action.uri
      : action?.kind === "error"
        ? action.uri
        : undefined
  return (
    <>
      <ErrorSummary errors={errors} attempt={action} />
      {heading}
      <p className="mt-2 mb-6 text-ink-muted">{m.twofactor_enroll_intro()}</p>
      {uri ? (
        <EnrollKey
          uri={uri}
          backupCodes={action?.backupCodes ?? []}
          saved={action?.kind === "error" && action.saved === true}
          error={errors.find((e) => e.fieldId === SAVED_ID)?.message}
        />
      ) : (
        <Form method="post" noValidate id="totp-enroll">
          <input type="hidden" name="intent" value="enroll" />
          <Button type="submit" pending={enrolling}>
            {m.twofactor_enroll_start()}
          </Button>
        </Form>
      )}
      {uri ? (
        <div className="mt-8">
          <CodeForm uri={uri} errors={errors} />
        </div>
      ) : null}
    </>
  )
}
