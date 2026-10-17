import { Fragment, type ReactNode } from "react"
import { Checkbox, Fieldset, Radio } from "~/components/ui/field"

export type Choice = { value: string; label: string; hint?: string }

type ChoiceGroupProps = {
  name: string
  legend: ReactNode
  legendAsHeading?: boolean
  hint?: ReactNode
  error?: string
  requiredMark?: boolean
  options: readonly Choice[]
  // Option grid, e.g. columns
  optionsClassName?: string
  // Compact rows without hints
  inline?: boolean
}

// First input gets bare id
function choiceId(name: string, index: number, value: string): string {
  return index === 0 ? name : `${name}-${value}`
}

export function RadioGroup({
  name,
  legend,
  legendAsHeading,
  hint,
  error,
  requiredMark,
  options,
  optionsClassName,
  inline,
  value,
  onChange,
  conditional,
}: ChoiceGroupProps & {
  value: string | undefined
  onChange: (value: string) => void
  // Follow-up under its option
  conditional?: Partial<Record<string, ReactNode>>
}) {
  return (
    <Fieldset
      id={`${name}-group`}
      legend={legend}
      legendAsHeading={legendAsHeading}
      hint={hint}
      error={error}
      requiredMark={requiredMark}
      optionsClassName={optionsClassName}
    >
      {options.map((option, index) => {
        const reveal = conditional?.[option.value]
        const revealId = `${name}-${option.value}-conditional`
        const checked = value === option.value
        return (
          <Fragment key={option.value}>
            <Radio
              id={choiceId(name, index, option.value)}
              name={name}
              value={option.value}
              label={option.label}
              hint={inline ? undefined : option.hint}
              inline={inline}
              checked={checked}
              required={requiredMark}
              aria-controls={reveal ? revealId : undefined}
              onChange={() => onChange(option.value)}
            />
            {reveal && (
              <div id={revealId} hidden={!checked}>
                {reveal}
              </div>
            )}
          </Fragment>
        )
      })}
    </Fieldset>
  )
}

export function CheckboxGroup({
  name,
  legend,
  hint,
  error,
  requiredMark,
  options,
  optionsClassName,
  inline,
  defaultValues,
}: ChoiceGroupProps & { defaultValues?: readonly string[] }) {
  return (
    <Fieldset
      id={`${name}-group`}
      legend={legend}
      hint={hint}
      error={error}
      requiredMark={requiredMark}
      optionsClassName={optionsClassName}
    >
      {options.map((option, index) => (
        <Checkbox
          key={option.value}
          id={choiceId(name, index, option.value)}
          name={name}
          value={option.value}
          label={option.label}
          hint={inline ? undefined : option.hint}
          inline={inline}
          defaultChecked={defaultValues?.includes(option.value)}
        />
      ))}
    </Fieldset>
  )
}

/** Choices from a label map. */
export function choicesFrom(
  values: readonly string[],
  labels: Record<string, () => string>,
  hints?: Record<string, () => string>,
): Choice[] {
  return values.map((value) => ({
    value,
    label: labels[value]?.() ?? value,
    hint: hints?.[value]?.(),
  }))
}
