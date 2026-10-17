import { useState } from "react"
import { m } from "~/paraglide/messages.js"
import { OTHER_CONSENTS, RELATIONS } from "../../../../shared/report-fields.ts"
import { choicesFrom, RadioGroup } from "../choices"
import { browserStorage, type Draft, saveStep } from "../draft"
import {
  OTHER_CONSENT_TEXT,
  RELATION_HINT_TEXT,
  RELATION_TEXT,
} from "../labels"
import { errorText, StepPage, useStepNav } from "../step-page"
import { type StepError, validateRelation } from "../validate"

export function RelationStep({ draft }: { draft: Draft }) {
  const { next } = useStepNav("relation")
  const [errors, setErrors] = useState<StepError[]>([])
  const [relation, setRelation] = useState(draft.relation?.relation)
  const [otherConsent, setOtherConsent] = useState(draft.relation?.otherConsent)

  const onContinue = () => {
    const answer =
      relation === "on_behalf" ? { relation, otherConsent } : { relation }
    const found = validateRelation(answer)
    setErrors(found)
    if (found.length > 0) return
    saveStep(browserStorage(), draft, "relation", answer)
    next()
  }

  return (
    <StepPage
      step="relation"
      title={m.step_relation_title()}
      titleInForm
      errors={errors}
      onContinue={onContinue}
    >
      <RadioGroup
        name="relation"
        legend={m.step_relation_title()}
        legendAsHeading
        error={errorText(errors, "relation")}
        requiredMark
        options={choicesFrom(RELATIONS, RELATION_TEXT, RELATION_HINT_TEXT)}
        optionsClassName="grid gap-3"
        value={relation}
        onChange={setRelation}
        conditional={{
          on_behalf: (
            <div className="mt-1 border-brand border-l-4 bg-surface p-4 sm:p-5">
              <RadioGroup
                name="otherConsent"
                legend={m.other_consent_legend()}
                hint={m.other_consent_hint()}
                error={errorText(errors, "otherConsent")}
                requiredMark
                options={choicesFrom(OTHER_CONSENTS, OTHER_CONSENT_TEXT)}
                value={otherConsent}
                onChange={setOtherConsent}
              />
            </div>
          ),
        }}
      />
    </StepPage>
  )
}
