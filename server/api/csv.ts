// RFC 4180 with OWASP guard

type Cell = string | number | null
export type Row = Readonly<Record<string, Cell>>

// OWASP CSV injection list
const FORMULA = /^[=+\-@\t\r\n＝＋－＠]/
// Semicolon locales split cells there
const INNER = /([;\r\n])(?=[=+\-@\t＝＋－＠"])/g
const QUOTE = /[",;\r\n]/

function cell(value: Cell | undefined): string {
  if (value === null || value === undefined) return ""
  if (typeof value === "number") return String(value)
  const guarded = value.replace(INNER, "$1'")
  const text = FORMULA.test(guarded) ? `'${guarded}` : guarded
  return QUOTE.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

/** Header line, CRLF records. */
export function toCsv(
  columns: readonly string[],
  rows: readonly Row[],
): string {
  const lines = [columns.map((name) => cell(name))]
  for (const row of rows) lines.push(columns.map((name) => cell(row[name])))
  return lines.map((line) => `${line.join(",")}\r\n`).join("")
}
