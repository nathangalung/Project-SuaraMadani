export type LogRecord = Record<string, unknown>

/** One JSON line to stdout. */
export function writeLog(record: LogRecord): void {
  console.log(JSON.stringify({ t: new Date().toISOString(), ...record }))
}

/** One JSON line to stderr. */
export function writeError(record: LogRecord): void {
  console.error(JSON.stringify({ t: new Date().toISOString(), ...record }))
}

type DbFields = {
  code?: unknown
  constraint?: unknown
  table?: unknown
  routine?: unknown
}

// Query parts hold personal data
function dbError(error: object): DbFields | undefined {
  let current: unknown = error
  let found = false
  for (
    let depth = 0;
    depth < 4 && current && typeof current === "object";
    depth++
  ) {
    if ("params" in current && "query" in current) found = true
    if ("severity" in current && "code" in current) return current
    current = (current as { cause?: unknown }).cause
  }
  return found ? {} : undefined
}

/** Loggable fields, no personal data. */
export function errorRecord(error: unknown): LogRecord {
  if (!error || typeof error !== "object") return { error: typeof error }
  const name = error instanceof Error ? error.name : "object"
  const db = dbError(error)
  if (db) {
    const { code, constraint, table, routine } = db
    return Object.fromEntries(
      Object.entries({ error: name, code, constraint, table, routine }).filter(
        ([, value]) => typeof value === "string",
      ),
    )
  }
  if (!(error instanceof Error)) return { error: "object" }
  return { error: name, message: error.message, stack: error.stack }
}
