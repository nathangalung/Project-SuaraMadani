import { ErrorSummary, errorTitle } from "~/components/ui/error-summary"
import { createDemandAction } from "~/features/demands/actions.server"
import { DemandFieldsForm, demandErrors } from "~/features/demands/editor-forms"
import { requireAdmin } from "~/features/moderation/access.server"
import { useSiteTitle } from "~/features/report/page-title"
import { regencyGroups } from "~/features/report/regions.server"
import { m } from "~/paraglide/messages.js"
import type { Route } from "./+types/demand-new"

export async function loader({ context }: Route.LoaderArgs) {
  await requireAdmin(context)
  return { regencies: await regencyGroups() }
}

export const action = createDemandAction

export default function NewDemand({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const errors = demandErrors(actionData?.errors ?? [])
  const title = m.demand_new_title()
  const pageTitle = useSiteTitle(title)
  return (
    <div>
      <title>{errorTitle(pageTitle, errors.length > 0)}</title>
      <ErrorSummary errors={errors} attempt={actionData} />
      <h1 className="font-bold font-heading text-3xl [font-synthesis-weight:none]">
        {title}
      </h1>
      <p className="mt-2 mb-8 text-ink-muted">{m.demand_new_lead()}</p>
      <DemandFieldsForm
        values={actionData?.values ?? {}}
        regencies={loaderData.regencies}
        errors={errors}
        intent="create"
        withItems
      />
    </div>
  )
}
