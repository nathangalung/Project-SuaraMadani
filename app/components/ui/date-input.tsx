import { useState } from "react"
import { m } from "~/paraglide/messages.js"
import { cn } from "./cn"
import { controlClass } from "./control"
import { controlProps, Field, type FieldProps } from "./field"

/** Device calendar day, YYYY-MM-DD. */
export function localIsoDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** Today, yesterday, capped at max. */
export function quickDates(now: Date, max: string) {
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  const cap = (iso: string) => (iso > max ? max : iso)
  return [
    { label: m.date_today(), value: cap(localIsoDate(now)) },
    { label: m.date_yesterday(), value: cap(localIsoDate(yesterday)) },
  ]
}

type DateInputProps = Omit<FieldProps, "labelAsHeading"> & {
  name: string
  min: string
  max: string
  defaultValue?: string
}

// Native picker, quick chips
export function DateInput({
  id,
  name,
  label,
  hint,
  error,
  optional,
  requiredMark,
  className,
  min,
  max,
  defaultValue,
}: DateInputProps) {
  const [value, setValue] = useState(defaultValue ?? "")
  // Report steps render client-side only
  const chips = quickDates(new Date(), max)
  return (
    <Field {...{ id, label, hint, error, optional, requiredMark, className }}>
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="date"
          name={name}
          min={min}
          max={max}
          value={value}
          onChange={(event) => setValue(event.currentTarget.value)}
          required={requiredMark}
          className={cn(controlClass, "h-12 w-full")}
          {...controlProps(id, hint, error)}
        />
        <div className="flex gap-2">
          {chips.map((chip) => {
            const chosen = value === chip.value
            return (
              <button
                key={chip.label}
                type="button"
                aria-controls={id}
                aria-pressed={chosen}
                onClick={() => setValue(chip.value)}
                className={cn(
                  "h-12 rounded-[10px] border-2 px-4 font-semibold text-sm transition-colors",
                  chosen
                    ? "border-brand bg-brand text-on-accent"
                    : "border-line bg-surface-raised text-ink hover:border-ink",
                )}
              >
                {chip.label}
              </button>
            )
          })}
        </div>
      </div>
    </Field>
  )
}
