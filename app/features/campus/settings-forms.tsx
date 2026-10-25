import { CirclePause, CirclePlay } from "lucide-react"
import { Form } from "react-router"
import { Badge } from "~/components/ui/badge"
import { Button } from "~/components/ui/button"
import { Fieldset, Radio, TextInput } from "~/components/ui/field"
import { useSubmitting } from "~/features/moderation/submitting"
import { m } from "~/paraglide/messages.js"

const CARD =
  "rounded-2xl border border-line-subtle bg-surface-raised p-5 sm:p-6"

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
