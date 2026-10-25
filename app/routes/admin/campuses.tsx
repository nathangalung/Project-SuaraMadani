import { Building2, ExternalLink } from "lucide-react"
import type { CSSProperties } from "react"
import { Form } from "react-router"
import { useStagger } from "~/components/layout/use-reveal"
import { Button } from "~/components/ui/button"
import { ErrorSummary, errorTitle } from "~/components/ui/error-summary"
import { TextInput } from "~/components/ui/field"
import { Note } from "~/components/ui/note"
import {
  apexHost,
  type CampusValues,
  campusAction,
} from "~/features/campus/campus-actions.server"
import {
  listCampuses,
  requireSuperadmin,
} from "~/features/campus/campuses.server"
import { requireFresh } from "~/features/moderation/step-up.server"
import { useSubmitting } from "~/features/moderation/submitting"
import { useSiteTitle } from "~/features/report/page-title"
import { m } from "~/paraglide/messages.js"
import type { CampusField } from "../../../shared/campus.ts"
import { formatDate, formatNumber } from "../../../shared/format.ts"
import type { Route } from "./+types/campuses"

export async function loader({ context, request }: Route.LoaderArgs) {
  requireSuperadmin(context)
  await requireFresh(context, request)
  return { campuses: await listCampuses(), apex: apexHost() }
}

export const action = campusAction

const FIELD_ID: Record<CampusField, string> = {
  campusName: "campus-name",
  name: "campus-operator",
  slug: "campus-slug",
  campusCode: "campus-code",
  adminEmail: "campus-admin",
  contactEmail: "campus-contact",
}

const FORMAT_ERROR: Record<CampusField, () => string> = {
  campusName: m.admin_error_campus_name,
  name: m.admin_error_operator,
  slug: m.admin_error_slug,
  campusCode: m.admin_error_code,
  adminEmail: m.error_email_format,
  contactEmail: m.error_email_format,
}

const TAKEN_ERROR: Partial<Record<CampusField, () => string>> = {
  slug: m.admin_error_slug_taken,
  campusCode: m.admin_error_code_taken,
}

const RESENT = {
  sent: m.admin_resent,
  failed: m.admin_resent_failed,
  limited: m.admin_resent_limited,
  not_found: m.admin_resent_not_found,
} as const

const CREATED = {
  sent: m.admin_created,
  failed: m.admin_created_unsent,
  limited: m.admin_created_limited,
} as const

const EMPTY: CampusValues = {
  campusName: "",
  name: "",
  slug: "",
  campusCode: "",
  adminEmail: "",
  contactEmail: "",
}

function CampusList({
  campuses,
}: {
  campuses: Route.ComponentProps["loaderData"]["campuses"]
}) {
  const list = useStagger<HTMLUListElement>()
  if (campuses.length === 0) {
    return <p className="mt-3 text-ink-muted">{m.admin_campuses_none()}</p>
  }
  return (
    <ul ref={list} className="mt-4 grid gap-3 sm:grid-cols-2">
      {campuses.map((campus, i) => (
        <li
          key={campus.id}
          style={{ "--i": i } as CSSProperties}
          className="flex flex-col gap-3 rounded-lg border border-line-subtle bg-surface-raised p-4"
        >
          <div className="flex items-start gap-3">
            <Building2
              aria-hidden="true"
              className="mt-0.5 size-5 shrink-0 text-accent"
            />
            <div className="min-w-0">
              <p className="font-semibold">{campus.campusName}</p>
              <p className="text-ink-muted text-sm">
                {campus.name}, {campus.campusCode}
              </p>
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <dt className="text-ink-muted">{m.admin_col_admins()}</dt>
            <dd className="text-right tabular-nums">
              {formatNumber(campus.admins)}
            </dd>
            <dt className="text-ink-muted">{m.admin_col_invitations()}</dt>
            <dd className="text-right tabular-nums">
              {formatNumber(campus.pendingInvitations)}
            </dd>
            <dt className="text-ink-muted">{m.admin_col_created()}</dt>
            <dd className="text-right">{formatDate(campus.createdAt)}</dd>
          </dl>
          {campus.admins === 0 && campus.pendingInvitations > 0 ? (
            <Form method="post">
              <input type="hidden" name="intent" value="resend" />
              <input type="hidden" name="org" value={campus.id} />
              <Button type="submit" size="sm" variant="secondary">
                {m.admin_resend()}
              </Button>
            </Form>
          ) : null}
          <a
            href={`//${campus.host}/`}
            className="inline-flex items-center gap-1.5 break-all font-semibold text-accent text-sm underline underline-offset-4 hover:decoration-2"
          >
            {campus.host}
            <ExternalLink aria-hidden="true" className="size-3.5 shrink-0" />
          </a>
        </li>
      ))}
    </ul>
  )
}

export default function Campuses({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const title = m.admin_campuses_title()
  const pageTitle = useSiteTitle(title)
  const pending = useSubmitting("create")
  const failed = actionData && "errors" in actionData ? actionData : null
  const created =
    actionData && "created" in actionData ? actionData.created : null
  const resent = actionData && "resent" in actionData ? actionData.resent : null
  const errors = (failed?.errors ?? []).map((field) => ({
    fieldId: FIELD_ID[field],
    message:
      (failed?.taken ? TAKEN_ERROR[field] : undefined)?.() ??
      FORMAT_ERROR[field](),
  }))
  const error = (field: CampusField) =>
    errors.find((e) => e.fieldId === FIELD_ID[field])?.message
  const values = failed?.values ?? EMPTY
  return (
    <div>
      <title>{errorTitle(pageTitle, errors.length > 0)}</title>
      <ErrorSummary errors={errors} attempt={actionData} />
      {resent ? (
        <div role="status" className="confirm-in mb-8">
          <Note tone={resent === "sent" ? "success" : "danger"}>
            {RESENT[resent]()}
          </Note>
        </div>
      ) : null}
      {created ? (
        <div role="status" className="confirm-in mb-8">
          <Note tone={created.mail === "sent" ? "success" : "danger"}>
            {CREATED[created.mail]({
              campus: created.campusName,
              host: created.host,
            })}
          </Note>
        </div>
      ) : null}
      <h1 className="font-bold font-heading text-3xl [font-synthesis-weight:none]">
        {title}
      </h1>
      <p className="mt-2 max-w-3xl text-ink-muted">{m.admin_campuses_lead()}</p>

      <section aria-labelledby="daftar-kampus" className="mt-10">
        <h2 id="daftar-kampus" className="font-bold text-2xl">
          {m.admin_list_title()}
        </h2>
        <CampusList campuses={loaderData.campuses} />
      </section>

      <section aria-labelledby="buat-kampus" className="mt-12 max-w-2xl">
        <h2 id="buat-kampus" className="font-bold text-2xl">
          {m.admin_create_title()}
        </h2>
        <p className="mt-2 mb-4 text-ink-muted">{m.admin_create_lead()}</p>
        <Form
          key={created?.host ?? "form"}
          method="post"
          className="flex flex-col gap-6 border border-line-subtle bg-surface-raised p-5 sm:p-6"
        >
          <input type="hidden" name="intent" value="create" />
          <TextInput
            id={FIELD_ID.campusName}
            name="campusName"
            label={m.admin_field_campus_name()}
            hint={m.admin_field_campus_name_hint()}
            defaultValue={values.campusName}
            error={error("campusName")}
            requiredMark
          />
          <TextInput
            id={FIELD_ID.name}
            name="name"
            label={m.admin_field_operator()}
            hint={m.admin_field_operator_hint()}
            defaultValue={values.name}
            error={error("name")}
            requiredMark
          />
          <div className="grid gap-6 sm:grid-cols-[1fr_10rem]">
            <TextInput
              id={FIELD_ID.slug}
              name="slug"
              label={m.admin_field_slug()}
              hint={m.admin_field_slug_hint({ apex: loaderData.apex })}
              defaultValue={values.slug}
              error={error("slug")}
              autoComplete="off"
              spellCheck={false}
              requiredMark
            />
            <TextInput
              id={FIELD_ID.campusCode}
              name="campusCode"
              label={m.admin_field_code()}
              hint={m.admin_field_code_hint()}
              defaultValue={values.campusCode}
              error={error("campusCode")}
              autoComplete="off"
              className="[&_input]:uppercase"
              requiredMark
            />
          </div>
          <TextInput
            id={FIELD_ID.adminEmail}
            name="adminEmail"
            type="email"
            label={m.admin_field_admin()}
            hint={m.admin_field_admin_hint()}
            defaultValue={values.adminEmail}
            error={error("adminEmail")}
            autoComplete="off"
            requiredMark
          />
          <TextInput
            id={FIELD_ID.contactEmail}
            name="contactEmail"
            type="email"
            label={m.admin_field_contact()}
            hint={m.admin_field_contact_hint()}
            defaultValue={values.contactEmail}
            error={error("contactEmail")}
            autoComplete="off"
            optional
          />
          <div>
            <Button type="submit" pending={pending}>
              {m.admin_create_submit()}
            </Button>
          </div>
        </Form>
      </section>
    </div>
  )
}
