import type {
  InputHTMLAttributes,
  ReactNode,
  TextareaHTMLAttributes,
} from "react"
import { m } from "~/paraglide/messages.js"
import { cn } from "./cn"
import { controlClass } from "./control"

export function describedBy(
  id: string,
  hasHint: boolean,
  hasError: boolean,
): string | undefined {
  const ids = [hasHint && `${id}-hint`, hasError && `${id}-error`]
  return ids.filter(Boolean).join(" ") || undefined
}

// Question heading inside the card
export const STEP_HEADING =
  "font-bold font-heading text-xl leading-snug [font-synthesis-weight:none] sm:text-2xl"

export type FieldProps = {
  id: string
  label: ReactNode
  hint?: ReactNode
  error?: string
  optional?: boolean
  // Red asterisk, sets required
  requiredMark?: boolean
  labelAsHeading?: boolean
  className?: string
}

// Beside the label, e.g. counter
type Aside = { aside?: ReactNode }

function RequiredMark() {
  return (
    <span aria-hidden="true" className="ml-0.5 text-danger">
      *
    </span>
  )
}

// Legend has no native required
function GroupMark() {
  return (
    <>
      <RequiredMark />
      <span className="sr-only"> {m.field_required()}</span>
    </>
  )
}

function Hint({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={`${id}-hint`} className="text-[0.95rem] text-ink-muted">
      {children}
    </p>
  )
}

export function ErrorMessage({
  id,
  children,
}: {
  id: string
  children: string
}) {
  return (
    <p id={`${id}-error`} className="font-semibold text-danger text-sm">
      <span className="sr-only">{m.field_error_prefix()}</span> {children}
    </p>
  )
}

function Label({
  id,
  label,
  optional,
  requiredMark,
  asHeading,
}: {
  id: string
  label: ReactNode
  optional?: boolean
  requiredMark?: boolean
  asHeading?: boolean
}) {
  const content = (
    <label
      htmlFor={id}
      className={asHeading ? STEP_HEADING : "font-semibold font-ui"}
    >
      {label}
      {optional && ` ${m.field_optional()}`}
      {requiredMark && <RequiredMark />}
    </label>
  )
  return asHeading ? <h1>{content}</h1> : content
}

// Label, hint, control, then error
export function Field({
  id,
  label,
  hint,
  error,
  optional,
  requiredMark,
  labelAsHeading,
  aside,
  className,
  children,
}: FieldProps & Aside & { children: ReactNode }) {
  const labelNode = (
    <Label
      id={id}
      label={label}
      optional={optional}
      requiredMark={requiredMark}
      asHeading={labelAsHeading}
    />
  )
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {aside ? (
        <div className="flex items-baseline justify-between gap-3">
          {labelNode}
          {aside}
        </div>
      ) : (
        labelNode
      )}
      {hint && <Hint id={id}>{hint}</Hint>}
      {children}
      {error && <ErrorMessage id={id}>{error}</ErrorMessage>}
    </div>
  )
}

export function controlProps(id: string, hint: unknown, error: unknown) {
  return {
    id,
    "aria-describedby": describedBy(id, Boolean(hint), Boolean(error)),
    "aria-invalid": error ? true : undefined,
  }
}

type InputProps = FieldProps &
  Aside &
  Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "className">

// Native file button, styled
const FILE_CLASS =
  "h-auto py-2 file:mr-3 file:cursor-pointer file:rounded-md file:border file:border-line file:bg-surface file:px-3 file:py-1.5 file:font-semibold file:font-ui file:text-ink"

export function TextInput({
  id,
  label,
  hint,
  error,
  optional,
  requiredMark,
  labelAsHeading,
  aside,
  prefix,
  className,
  type = "text",
  ...rest
}: InputProps & {
  // Fixed text inside, e.g. +62
  prefix?: string
}) {
  const input = (
    <input
      type={type}
      className={cn(
        controlClass,
        type === "file" ? FILE_CLASS : "h-12",
        "w-full",
        prefix && "pl-16",
      )}
      required={requiredMark}
      {...controlProps(id, hint, error)}
      {...rest}
    />
  )
  return (
    <Field
      {...{ id, label, hint, error, optional, requiredMark, labelAsHeading }}
      aside={aside}
      className={className}
    >
      {prefix ? (
        <div className="relative">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-0 flex items-center border-line border-r-2 px-3 font-semibold text-ink"
          >
            {prefix}
          </span>
          {input}
        </div>
      ) : (
        input
      )}
    </Field>
  )
}

type TextareaProps = FieldProps &
  Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id" | "className">

export function Textarea({
  id,
  label,
  hint,
  error,
  optional,
  requiredMark,
  labelAsHeading,
  className,
  ...rest
}: TextareaProps) {
  return (
    <Field
      {...{ id, label, hint, error, optional, requiredMark, labelAsHeading }}
      className={className}
    >
      <textarea
        className={cn(controlClass, "min-h-32 w-full py-3 leading-relaxed")}
        required={requiredMark}
        {...controlProps(id, hint, error)}
        {...rest}
      />
    </Field>
  )
}

type FieldsetProps = {
  id: string
  legend: ReactNode
  hint?: ReactNode
  error?: string
  requiredMark?: boolean
  legendAsHeading?: boolean
  // A page heading already asks
  legendHidden?: boolean
  // Replaces the option list layout
  optionsClassName?: string
  className?: string
  children: ReactNode
}

export function Fieldset({
  id,
  legend,
  hint,
  error,
  requiredMark,
  legendAsHeading,
  legendHidden,
  optionsClassName = "flex flex-col gap-2",
  className,
  children,
}: FieldsetProps) {
  return (
    <fieldset
      id={id}
      aria-describedby={describedBy(id, Boolean(hint), Boolean(error))}
      className={cn("min-w-0", className)}
    >
      <legend
        className={legendHidden ? "sr-only" : "mb-1.5 font-semibold font-ui"}
      >
        {legendAsHeading ? (
          <h1 className={STEP_HEADING}>
            {legend}
            {requiredMark && <GroupMark />}
          </h1>
        ) : (
          <>
            {legend}
            {requiredMark && <GroupMark />}
          </>
        )}
      </legend>
      {hint && <Hint id={id}>{hint}</Hint>}
      <div className={cn("mt-2", optionsClassName)}>{children}</div>
      {error && (
        <div className="mt-2">
          <ErrorMessage id={id}>{error}</ErrorMessage>
        </div>
      )}
    </fieldset>
  )
}

type ChoiceProps = {
  id: string
  label: ReactNode
  hint?: ReactNode
  // Compact row, no hint
  inline?: boolean
  // Required box, red asterisk
  requiredMark?: boolean
} & Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "type" | "className">

function Choice({
  id,
  label,
  hint,
  type,
  inline,
  requiredMark,
  ...rest
}: ChoiceProps & { type: "radio" | "checkbox" }) {
  if (inline) {
    return (
      <div className="flex items-center gap-2.5 py-1">
        <input
          id={id}
          type={type}
          className="size-5 shrink-0 cursor-pointer accent-brand"
          {...rest}
        />
        <label htmlFor={id} className="cursor-pointer select-none">
          {label}
        </label>
      </div>
    )
  }
  return (
    <div className="flex items-start gap-3 py-1">
      <input
        id={id}
        type={type}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className="mt-0.5 size-5 shrink-0 cursor-pointer accent-brand"
        required={requiredMark || undefined}
        {...rest}
      />
      <div className="flex flex-col gap-0.5">
        <label htmlFor={id} className="cursor-pointer font-semibold font-ui">
          {label}
          {requiredMark && <RequiredMark />}
        </label>
        {hint && <Hint id={id}>{hint}</Hint>}
      </div>
    </div>
  )
}

export function Radio(props: ChoiceProps) {
  return <Choice type="radio" {...props} />
}

export function Checkbox(props: ChoiceProps) {
  return <Choice type="checkbox" {...props} />
}
