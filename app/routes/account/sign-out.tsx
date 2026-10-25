import { Form, redirect } from "react-router"
import { AUTH_TITLE, AuthCard } from "~/components/layout/auth-card"
import { Button, ButtonLink } from "~/components/ui/button"
import { browserStorage, clearDraft } from "~/features/report/draft-store"
import { useSiteTitle } from "~/features/report/page-title"
import { signOut } from "~/features/report/sign-out.server"
import { m } from "~/paraglide/messages.js"
import { sessionContext } from "../../context.ts"
import type { Route } from "./+types/sign-out"

// Logo-only header, task focus
export const handle = { shell: "auth" }

// Ask first, team 25 Oct
export function loader({ context }: Route.LoaderArgs) {
  if (!context.get(sessionContext)) throw redirect("/")
  return null
}

export function action({ request }: Route.ActionArgs) {
  return signOut(request)
}

export default function SignOutPage() {
  return (
    <AuthCard>
      <title>{useSiteTitle(m.signout_title())}</title>
      <h1 className={AUTH_TITLE}>{m.signout_title()}</h1>
      <p className="mt-3 text-ink-soft leading-relaxed">{m.signout_body()}</p>
      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <Form
          method="post"
          action="/keluar"
          onSubmit={() => clearDraft(browserStorage())}
        >
          <Button type="submit" className="w-full sm:w-auto">
            {m.signout_confirm()}
          </Button>
        </Form>
        <ButtonLink to="/" variant="secondary">
          {m.signout_cancel()}
        </ButtonLink>
      </div>
    </AuthCard>
  )
}
