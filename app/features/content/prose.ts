import { formatDate } from "../../../shared/format.ts"

// Shared by About and policies
export const PROSE_LINK =
  "font-semibold text-accent underline underline-offset-4 hover:no-underline"
export const PROSE_LIST =
  "mt-3 list-disc space-y-1.5 pl-5 leading-relaxed marker:text-brand"

/** Fixed date, never render time. */
export function updatedOn(iso: string): string {
  return formatDate(new Date(`${iso}T12:00:00+07:00`))
}
