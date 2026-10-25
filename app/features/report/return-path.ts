// Known pages only, never //host
const RETURN_PATH =
  /^\/(?:(?:isu|tuntutan)\/[A-Z0-9-]{1,40}|lacak|undangan\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/

/** Where /masuk goes afterwards. */
export function returnPath(value: string | null): string | null {
  return value !== null && RETURN_PATH.test(value) ? value : null
}
