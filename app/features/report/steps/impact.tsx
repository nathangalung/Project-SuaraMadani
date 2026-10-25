import { useState } from "react"
import { m } from "~/paraglide/messages.js"
import {
  AFFECTED_COUNTS,
  AFFECTED_GROUPS,
  ONGOING,
} from "../../../../shared/report-fields.ts"
import { CheckboxGroup, choicesFrom, RadioGroup } from "../choices"
import { browserStorage, type Draft, saveStep } from "../draft"
import { COUNT_TEXT, GROUP_TEXT, ONGOING_TEXT } from "../labels"
import { errorText, StepPage, useStepNav } from "../step-page"
import { type StepError, validateImpact } from "../validate"

export function ImpactStep({ draft }: { draft: Draft }) {
  const { next } = useStepNav("impact")
  const saved = draft.impact ?? {}
  const [errors, setErrors] = useState<StepError[]>([])
  const [affectedCount, setAffectedCount] = useState(saved.affectedCount)
  const [ongoing, setOngoing] = useState(saved.ongoing)

  const onContinue = (form: HTMLFormElement) => {
    const groups = new FormData(form)
      .getAll("groups")
      .filter((value): value is string => typeof value === "string")
    const answer = { groups, affectedCount, ongoing }
    const found = validateImpact(answer)
    setErrors(found)
    if (found.length > 0) return
    saveStep(browserStorage(), draft, "impact", answer)
    next()
  }

  return (
    <StepPage
      step="impact"
      title={m.step_impact_title()}
      errors={errors}
      setErrors={setErrors}
      onContinue={onContinue}
    >
      <CheckboxGroup
        name="groups"
        legend={m.impact_groups_legend()}
        hint={m.impact_groups_hint()}
        error={errorText(errors, "groups")}
        requiredMark
        options={choicesFrom(AFFECTED_GROUPS, GROUP_TEXT)}
        optionsClassName="grid gap-x-6 gap-y-1 sm:grid-cols-2"
        inline
        defaultValues={saved.groups}
      />
      <RadioGroup
        name="affectedCount"
        legend={m.impact_count_label()}
        error={errorText(errors, "affectedCount")}
        requiredMark
        options={choicesFrom(AFFECTED_COUNTS, COUNT_TEXT)}
        optionsClassName="grid gap-x-6 gap-y-1 sm:grid-cols-2"
        inline
        value={affectedCount}
        onChange={setAffectedCount}
      />
      <RadioGroup
        name="ongoing"
        legend={m.impact_ongoing_legend()}
        error={errorText(errors, "ongoing")}
        requiredMark
        options={choicesFrom(ONGOING, ONGOING_TEXT)}
        optionsClassName="grid gap-2 sm:grid-cols-3"
        inline
        value={ongoing}
        onChange={setOngoing}
      />
    </StepPage>
  )
}
