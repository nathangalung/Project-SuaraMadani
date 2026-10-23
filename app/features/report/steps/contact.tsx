import { useState } from "react"
import { m } from "~/paraglide/messages.js"
import { CONTACT_METHODS } from "../../../../shared/report-fields.ts"
import { choicesFrom, RadioGroup } from "../choices"
import { browserStorage, type Draft, saveStep } from "../draft"
import { CONTACTABLE_TEXT, METHOD_TEXT } from "../labels"
import { errorText, StepPage, useStepNav } from "../step-page"
import { type StepError, validateContact } from "../validate"

export function ContactStep({ draft }: { draft: Draft }) {
  const { next } = useStepNav("contact")
  const [errors, setErrors] = useState<StepError[]>([])
  const [contactable, setContactable] = useState(draft.contact?.contactable)
  const [method, setMethod] = useState(draft.contact?.method)

  const onContinue = () => {
    const answer =
      contactable === "yes" ? { contactable, method } : { contactable }
    const found = validateContact(answer)
    setErrors(found)
    if (found.length > 0) return
    saveStep(browserStorage(), draft, "contact", answer)
    next()
  }

  return (
    <StepPage
      step="contact"
      title={m.step_contact_title()}
      titleInForm
      errors={errors}
      setErrors={setErrors}
      onContinue={onContinue}
    >
      <RadioGroup
        name="contactable"
        legend={m.step_contact_title()}
        legendAsHeading
        hint={m.contact_hint()}
        error={errorText(errors, "contactable")}
        requiredMark
        options={choicesFrom(["yes", "no"], CONTACTABLE_TEXT)}
        optionsClassName="grid gap-3"
        value={contactable}
        onChange={setContactable}
        conditional={{
          yes: (
            <div className="mt-4 ml-8 flex flex-col gap-5">
              <RadioGroup
                name="method"
                legend={m.contact_method_legend()}
                error={errorText(errors, "method")}
                requiredMark
                options={choicesFrom(CONTACT_METHODS, METHOD_TEXT)}
                optionsClassName="grid grid-cols-2 gap-2"
                inline
                value={method}
                onChange={setMethod}
              />
            </div>
          ),
        }}
      />
    </StepPage>
  )
}
