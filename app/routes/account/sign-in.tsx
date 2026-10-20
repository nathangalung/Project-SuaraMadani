import { Lock, MailCheck, MessageCircle } from "lucide-react"
import { data, Form, Link, useNavigate, useRevalidator } from "react-router"
import { AUTH_TITLE, AuthCard } from "~/components/layout/auth-card"
import { focusPageHeading } from "~/components/layout/route-focus"
import { Button, ButtonLink } from "~/components/ui/button"
import { ErrorSummary } from "~/components/ui/error-summary"
import { TextInput } from "~/components/ui/field"
import { Note } from "~/components/ui/note"
import { useSubmitting } from "~/features/moderation/submitting"
import {
  type AddPhoneError,
  addPhone,
} from "~/features/report/add-phone.server"
import { browserStorage, clearDraft } from "~/features/report/draft-store"
import { useOnChange } from "~/features/report/focus"
import { useSiteTitle } from "~/features/report/page-title"
import { returnPath } from "~/features/report/return-path"
import { SignedInAs, SignIn } from "~/features/report/sign-in"
import { m } from "~/paraglide/messages.js"
import { sessionContext, signedInLabel } from "../../context.ts"
import type { Route } from "./+types/sign-in"

// Logo-only header, task focus
export const handle = { shell: "auth" }

export function headers() {
  return { "Cache-Control": "private, no-store" }
}

export function loader({ request, context }: Route.LoaderArgs) {
  const session = context.get(sessionContext)
  const params = new URL(request.url).searchParams
  return {
    siteKey: process.env.TURNSTILE_SITE_KEY ?? "",
    signedInAs: signedInLabel(session),
    next: returnPath(params.get("kembali")),
    // Home "Buat akun" opens Daftar
    signUp: params.get("daftar") === "1",
    // Number released to its prover
    needsPhone: session ? !session.user.phoneNumber : false,
  }
}

type PhoneResult = { error?: AddPhoneError; saved?: boolean }

export async function action({ request, context }: Route.ActionArgs) {
  const session = context.get(sessionContext)
  if (!session) throw data(null, { status: 403 })
  const form = await request.formData()
  if (form.get("intent") !== "add_phone") throw data(null, { status: 400 })
  const phone = form.get("phone")
  const result = await addPhone(
    session.user.id,
    typeof phone === "string" ? phone : "",
  )
  const found: PhoneResult = result.ok
    ? { saved: true }
    : { error: result.error }
  return found
}

const PHONE_ID = "add-phone"

const PHONE_ERROR: Record<AddPhoneError, () => string> = {
  format: m.error_phone_format,
  taken: m.error_phone_add_taken,
  pending: m.error_phone_add_pending,
  // Saved in another tab
  exists: m.error_phone_add_taken,
}

/** Phoneless account adds its number. */
function AddPhone({ error }: { error?: AddPhoneError }) {
  const busy = useSubmitting()
  const message = error ? PHONE_ERROR[error]() : undefined
  return (
    <section
      aria-labelledby="add-phone-title"
      className="mt-6 flex flex-col gap-5 border-brand border-l-4 bg-surface p-4 sm:p-5"
    >
      {message ? (
        <ErrorSummary errors={[{ fieldId: PHONE_ID, message }]} />
      ) : null}
      <h2 id="add-phone-title" className="font-bold text-lg">
        {m.signin_phone_title()}
      </h2>
      <p className="text-ink-soft leading-relaxed">{m.signin_phone_lead()}</p>
      <Form method="post" noValidate className="flex flex-col gap-5">
        <input type="hidden" name="intent" value="add_phone" />
        <TextInput
          id={PHONE_ID}
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          label={m.signin_phone_label()}
          hint={m.signin_phone_hint()}
          error={message}
          required
        />
        <Button
          type="submit"
          className="w-full sm:w-auto"
          pending={busy}
          pendingLabel={m.signin_checking()}
        >
          {m.signin_phone_submit()}
        </Button>
      </Form>
    </section>
  )
}

// Sign-in needs JS (Turnstile)
export default function SignInPage({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const revalidator = useRevalidator()
  const navigate = useNavigate()
  const { next } = loaderData
  const title = useSiteTitle(m.signin_page_title())
  // Sign-in form was replaced
  useOnChange(loaderData.signedInAs, () => {
    if (loaderData.signedInAs) focusPageHeading(document)
  })
  return (
    <AuthCard>
      <title>{title}</title>
      {loaderData.signedInAs ? (
        <>
          <h1 className={AUTH_TITLE}>{m.signin_done_title()}</h1>
          <p className="mt-2 text-ink-muted leading-relaxed">
            <SignedInAs email={loaderData.signedInAs} /> {m.signin_page_done()}
          </p>
          {actionData?.saved ? (
            <Note className="mt-4">{m.signin_phone_saved()}</Note>
          ) : null}
          {loaderData.needsPhone ? (
            <AddPhone error={actionData?.error} />
          ) : null}
          {/* Second action, other destination */}
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            {next ? (
              <ButtonLink to={next}>{m.signin_continue()}</ButtonLink>
            ) : (
              <ButtonLink to="/lacak">{m.nav_track()}</ButtonLink>
            )}
            <form
              method="post"
              action="/keluar"
              onSubmit={() => clearDraft(browserStorage())}
            >
              <input type="hidden" name="next" value="/masuk" />
              <Button type="submit" variant="secondary" className="w-full">
                {m.signin_switch_email()}
              </Button>
            </form>
          </div>
        </>
      ) : (
        <>
          <noscript>
            <p className="mb-6 border-4 border-ink p-5 font-semibold">
              {m.signin_noscript()}
            </p>
          </noscript>
          <SignIn
            siteKey={loaderData.siteKey}
            onSignedIn={() =>
              next ? void navigate(next) : void revalidator.revalidate()
            }
            primary
            initialMode={loaderData.signUp ? "sign-up" : "sign-in"}
            intro={m.signin_page_intro()}
            heading={{
              start: <h1 className={AUTH_TITLE}>{m.signin_page_heading()}</h1>,
              channel: (
                <h1 className={AUTH_TITLE}>{m.signin_channel_title()}</h1>
              ),
              code: (channel) => (
                <div>
                  <span
                    aria-hidden="true"
                    className="grid size-12 place-items-center bg-brand"
                  >
                    {channel === "whatsapp" ? (
                      <MessageCircle className="size-6 text-on-accent" />
                    ) : (
                      <MailCheck className="size-6 text-on-accent" />
                    )}
                  </span>
                  <h1 className={`mt-4 ${AUTH_TITLE}`}>
                    {channel === "whatsapp"
                      ? m.signin_check_whatsapp_title()
                      : m.signin_check_email_title()}
                  </h1>
                </div>
              ),
            }}
          />
        </>
      )}
      <p className="mt-7 flex gap-2 border-line-subtle border-t pt-5 text-ink-soft text-sm leading-relaxed">
        <Lock aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <span>
          {m.signin_privacy_note()}{" "}
          <Link
            to="/privasi"
            className="font-semibold text-accent underline underline-offset-4 hover:no-underline"
          >
            {m.privacy_link()}
          </Link>
        </span>
      </p>
    </AuthCard>
  )
}
