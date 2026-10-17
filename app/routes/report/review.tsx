import { useRevalidator } from "react-router"
import { browserStorage, readDraft } from "~/features/report/draft"
import { Review } from "~/features/report/review"
import type { ReportHandle } from "~/features/report/step-page"
import { submitAction } from "~/features/report/submit.server"
import { latestIsoDate } from "../../../shared/format.ts"
import { accountLabel, maskPhone } from "../../../shared/phone.ts"
import { sessionContext, tenantContext } from "../../context.ts"
import type { Route } from "./+types/review"

export { StepFallback as HydrateFallback } from "~/features/report/step-page"

// Form owns the sign-in
export const handle: ReportHandle & { pageSignIn: true } = {
  reportStep: "consent",
  pageSignIn: true,
}

export function loader({ context }: Route.LoaderArgs) {
  const session = context.get(sessionContext)
  return {
    siteKey: process.env.TURNSTILE_SITE_KEY ?? "",
    operator: context.get(tenantContext).name,
    signedInAs: session ? accountLabel(session.user) : null,
    signedInPhone: session?.user.phoneNumber
      ? maskPhone(session.user.phoneNumber)
      : null,
    signedInPhoneVerified: session?.user.phoneVerified === true,
    today: latestIsoDate(new Date()),
  }
}

// Draft lives in sessionStorage
export async function clientLoader({ serverLoader }: Route.ClientLoaderArgs) {
  return { ...(await serverLoader()), draft: readDraft(browserStorage()) }
}
clientLoader.hydrate = true as const

export function action({ request, context }: Route.ActionArgs) {
  return submitAction({
    request,
    tenant: context.get(tenantContext),
    session: context.get(sessionContext),
  })
}

export default function Step({ loaderData }: Route.ComponentProps) {
  const revalidator = useRevalidator()
  return (
    <Review
      draft={loaderData.draft}
      today={loaderData.today}
      signedInAs={loaderData.signedInAs}
      signedInPhone={loaderData.signedInPhone}
      signedInPhoneVerified={loaderData.signedInPhoneVerified}
      siteKey={loaderData.siteKey}
      operator={loaderData.operator}
      onSessionChange={() => void revalidator.revalidate()}
    />
  )
}
