// Shared form parsing helpers

export const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Controls except tab and newlines
const CONTROL = /[^\P{Cc}\t\n\r]/gu

export function text(form: FormData, key: string): string {
  const value = form.get(key)
  return typeof value === "string" ? value.replace(CONTROL, "").trim() : ""
}

export function oneOf<T extends string>(
  values: readonly T[],
  value: string,
): T | null {
  return (values as readonly string[]).includes(value) ? (value as T) : null
}

export function within(value: string, range: { min: number; max: number }) {
  return value.length >= range.min && value.length <= range.max
}

/** Line breaks kept, CRLF normalised. */
export function longText(form: FormData, key: string): string {
  return text(form, key).replaceAll("\r\n", "\n")
}
