import type { SelectHTMLAttributes } from "react"
import { controlProps, Field, type FieldProps } from "./field"
import { SelectControl } from "./select-control"

type SelectProps = FieldProps &
  Omit<SelectHTMLAttributes<HTMLSelectElement>, "id" | "className">

// Native select, styled chevron
export function Select({
  id,
  label,
  hint,
  error,
  optional,
  requiredMark,
  labelAsHeading,
  className,
  children,
  ...rest
}: SelectProps) {
  return (
    <Field
      {...{ id, label, hint, error, optional, requiredMark, labelAsHeading }}
      className={className}
    >
      <SelectControl
        required={requiredMark}
        {...controlProps(id, hint, error)}
        {...rest}
      >
        {children}
      </SelectControl>
    </Field>
  )
}
