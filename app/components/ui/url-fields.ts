import { type RefObject, useEffect } from "react"

type Fields = { namedItem(name: string): unknown }

/** Writes URL values into fields. */
export function syncFields(fields: Fields, values: Record<string, string>) {
  for (const [name, value] of Object.entries(values)) {
    const field = fields.namedItem(name)
    if (field && typeof field === "object" && "value" in field) {
      field.value = value
    }
  }
}

// Back and Forward keep focus
export function useUrlFields(
  form: RefObject<HTMLFormElement | null>,
  values: Record<string, string>,
) {
  const key = new URLSearchParams(values).toString()
  useEffect(() => {
    const fields = form.current?.elements
    if (fields) syncFields(fields, Object.fromEntries(new URLSearchParams(key)))
  }, [form, key])
}
