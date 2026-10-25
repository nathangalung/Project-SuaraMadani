import { CirclePause, CirclePlay, ImageUp } from "lucide-react"
import { useState } from "react"
import { Form } from "react-router"
import { Badge } from "~/components/ui/badge"
import { Button } from "~/components/ui/button"
import { Fieldset, Radio, Textarea, TextInput } from "~/components/ui/field"
import { useSubmitting } from "~/features/moderation/submitting"
import { m } from "~/paraglide/messages.js"
import {
  type IdentityField,
  LOGO_MAX_BYTES,
  logoTooLarge,
} from "../../../shared/campus.ts"

const CARD = "border border-line-subtle bg-surface-raised p-5 sm:p-6"

export function IntakeForm({
  paused,
  statusUrl,
  errors,
}: {
  paused: boolean
  statusUrl: string
  errors: { choice?: string; statusUrl?: string }
}) {
  const pending = useSubmitting("intake")
  return (
    <Form method="post" className={`${CARD} flex flex-col gap-6`}>
      <input type="hidden" name="intent" value="intake" />
      <p className="flex flex-wrap items-center gap-3">
        <span className="font-semibold">{m.settings_intake_now()}</span>
        {paused ? (
          <Badge tone="danger">
            <CirclePause aria-hidden="true" className="size-3.5" />
            {m.settings_intake_paused()}
          </Badge>
        ) : (
          <Badge tone="success">
            <CirclePlay aria-hidden="true" className="size-3.5" />
            {m.settings_intake_open()}
          </Badge>
        )}
      </p>
      <Fieldset
        id="intake-choice"
        legend={m.settings_intake_legend()}
        error={errors.choice}
        requiredMark
      >
        <Radio
          id="intake-choice-open"
          name="intake"
          value="open"
          label={m.settings_intake_choice_open()}
          hint={m.settings_intake_choice_open_hint()}
          defaultChecked={!paused}
        />
        <Radio
          id="intake-choice-paused"
          name="intake"
          value="paused"
          label={m.settings_intake_choice_paused()}
          hint={m.settings_intake_choice_paused_hint()}
          defaultChecked={paused}
        />
      </Fieldset>
      <TextInput
        id="intake-status"
        name="statusUrl"
        type="url"
        inputMode="url"
        label={m.settings_status_url()}
        hint={m.settings_status_url_hint()}
        defaultValue={statusUrl}
        error={errors.statusUrl}
        optional
      />
      <div>
        <Button type="submit" pending={pending}>
          {m.settings_intake_submit()}
        </Button>
      </div>
    </Form>
  )
}

export function LogoForm({
  logoSrc,
  custom,
  error,
}: {
  logoSrc: string
  custom: boolean
  error?: string
}) {
  const uploading = useSubmitting("logo")
  const removing = useSubmitting("logo_remove")
  const [tooLarge, setTooLarge] = useState(false)
  return (
    <div className={`${CARD} flex flex-col gap-6 sm:flex-row sm:items-start`}>
      <div className="flex shrink-0 flex-col items-center gap-2">
        <div className="grid size-28 place-items-center border border-line-subtle bg-surface">
          <img
            src={logoSrc}
            alt={m.settings_logo_current()}
            className="max-h-20 max-w-24 object-contain"
          />
        </div>
        <span className="text-ink-muted text-xs">
          {custom ? m.settings_logo_custom() : m.settings_logo_default()}
        </span>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <Form
          method="post"
          encType="multipart/form-data"
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            const input = event.currentTarget.elements.namedItem("logo")
            const file =
              input instanceof HTMLInputElement ? input.files?.[0] : undefined
            // Server never sees it
            const large = logoTooLarge(file)
            setTooLarge(large)
            if (large) event.preventDefault()
          }}
        >
          <input type="hidden" name="intent" value="logo" />
          <TextInput
            id="logo-file"
            name="logo"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            label={m.settings_logo_file()}
            hint={m.settings_logo_hint({
              size: String(Math.floor(LOGO_MAX_BYTES / 1024)),
            })}
            error={tooLarge ? m.settings_error_logo() : error}
            requiredMark
          />
          <div>
            <Button type="submit" variant="secondary" pending={uploading}>
              <ImageUp aria-hidden="true" className="size-5" />
              {m.settings_logo_submit()}
            </Button>
          </div>
        </Form>
        {custom ? (
          <Form method="post">
            <input type="hidden" name="intent" value="logo_remove" />
            <Button type="submit" variant="quiet" size="sm" pending={removing}>
              {m.settings_logo_remove()}
            </Button>
          </Form>
        ) : null}
      </div>
    </div>
  )
}

type IdentityValues = Record<
  "name" | "campusName" | "contactEmail" | "alliance" | "legalNumber",
  string
> & { credit: string; officers: string }

const IDENTITY_ERROR: Record<IdentityField, () => string> = {
  name: m.admin_error_operator,
  campusName: m.admin_error_campus_name,
  contactEmail: m.error_email_format,
  alliance: m.settings_error_alliance,
  legalNumber: m.settings_error_legal_number,
  credit: m.settings_error_credit,
  officers: m.settings_error_officers,
}

export function identityErrors(fields: readonly IdentityField[]) {
  return fields.map((field) => ({
    fieldId: `identity-${field}`,
    message: IDENTITY_ERROR[field](),
  }))
}

/** Footer and /tentang facts. */
export function IdentityForm({
  values,
  invalid,
}: {
  values: IdentityValues
  invalid: readonly IdentityField[]
}) {
  const pending = useSubmitting("identity")
  const error = (field: IdentityField) =>
    invalid.includes(field) ? IDENTITY_ERROR[field]() : undefined
  const input = (
    field: Exclude<IdentityField, "officers">,
    label: string,
    hint: string,
    optional: boolean,
  ) => (
    <TextInput
      id={`identity-${field}`}
      name={field}
      type={field === "contactEmail" ? "email" : "text"}
      label={label}
      hint={hint}
      defaultValue={values[field]}
      error={error(field)}
      optional={optional}
      requiredMark={!optional}
    />
  )
  return (
    <Form method="post" className={`${CARD} flex flex-col gap-6`}>
      <input type="hidden" name="intent" value="identity" />
      {input(
        "name",
        m.admin_field_operator(),
        m.admin_field_operator_hint(),
        false,
      )}
      {input(
        "campusName",
        m.admin_field_campus_name(),
        m.admin_field_campus_name_hint(),
        false,
      )}
      {input(
        "contactEmail",
        m.admin_field_contact(),
        m.admin_field_contact_hint(),
        true,
      )}
      {input(
        "alliance",
        m.settings_field_alliance(),
        m.settings_field_alliance_hint(),
        true,
      )}
      {input(
        "legalNumber",
        m.settings_field_legal_number(),
        m.settings_field_legal_number_hint(),
        true,
      )}
      {input(
        "credit",
        m.settings_field_credit(),
        m.settings_field_credit_hint(),
        true,
      )}
      <Textarea
        id="identity-officers"
        name="officers"
        label={m.settings_field_officers()}
        hint={m.settings_field_officers_hint()}
        defaultValue={values.officers}
        error={error("officers")}
        rows={5}
        optional
      />
      <div>
        <Button type="submit" pending={pending}>
          {m.settings_identity_submit()}
        </Button>
      </div>
    </Form>
  )
}
