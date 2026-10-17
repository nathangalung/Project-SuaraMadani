import { AUTH_TITLE, AuthCard } from "~/components/layout/auth-card"
import { TwoFactorSteps } from "~/features/moderation/two-factor"
import {
  twoFactorAction,
  twoFactorLoader,
} from "~/features/moderation/two-factor.server"
import { useSiteTitle } from "~/features/report/page-title"
import { m } from "~/paraglide/messages.js"
import type { Route } from "./+types/two-factor"

// Logo-only header, task focus
export const handle = { shell: "auth" }

export function headers() {
  return { "Cache-Control": "private, no-store" }
}

// Outside /kelola, before TOTP
export function loader(args: Route.LoaderArgs) {
  return twoFactorLoader(args)
}

export function action(args: Route.ActionArgs) {
  return twoFactorAction(args)
}

export default function TwoFactor({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  return (
    <AuthCard>
      <title>{useSiteTitle(m.twofactor_title())}</title>
      <TwoFactorSteps
        page={loaderData}
        action={actionData}
        heading={<h1 className={AUTH_TITLE}>{m.twofactor_title()}</h1>}
      />
    </AuthCard>
  )
}
