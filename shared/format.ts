const LOCALE = "id-ID"
const TIME_ZONE = "Asia/Jakarta"
const DAY_MS = 86_400_000

const longDate = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TIME_ZONE,
  day: "numeric",
  month: "long",
  year: "numeric",
})

const dateTime = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TIME_ZONE,
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
})

function isoFormat(timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
}

const isoParts = isoFormat(TIME_ZONE)
// Easternmost Indonesian zone (WIT)
const latestParts = isoFormat("Asia/Jayapura")

const number = new Intl.NumberFormat(LOCALE)

const percent = new Intl.NumberFormat(LOCALE, {
  style: "percent",
  maximumFractionDigits: 1,
})

export function formatDate(date: Date): string {
  return longDate.format(date)
}

export function formatDateTime(date: Date): string {
  return dateTime.format(date)
}

export function formatNumber(value: number): string {
  return number.format(value)
}

export function formatPercent(ratio: number): string {
  return percent.format(ratio)
}

function isoDate(format: Intl.DateTimeFormat, date: Date): string {
  let year = ""
  let month = ""
  let day = ""
  for (const part of format.formatToParts(date)) {
    if (part.type === "year") year = part.value
    else if (part.type === "month") month = part.value
    else if (part.type === "day") day = part.value
  }
  return `${year}-${month}-${day}`
}

/** Jakarta calendar day, YYYY-MM-DD. */
export function jakartaIsoDate(date: Date): string {
  return isoDate(isoParts, date)
}

/** No reporter's today is later. */
export function latestIsoDate(date: Date): string {
  return isoDate(latestParts, date)
}

export function jakartaYear(date: Date): number {
  return Number(jakartaIsoDate(date).slice(0, 4))
}

/** Jakarta month, 1 to 12. */
export function jakartaMonth(date: Date): number {
  return Number(jakartaIsoDate(date).slice(5, 7))
}

/** Jakarta calendar days, never negative. */
export function daysSince(start: Date, now: Date): number {
  const from = Date.parse(jakartaIsoDate(start))
  const to = Date.parse(jakartaIsoDate(now))
  return Math.max(0, Math.round((to - from) / DAY_MS))
}

/** Stored calendar day, no shift. */
export function formatIsoDate(iso: string): string {
  return longDate.format(new Date(`${iso}T12:00:00+07:00`))
}

/** Video length as m:ss. */
export function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000)
  const seconds = String(total % 60).padStart(2, "0")
  return `${Math.floor(total / 60)}:${seconds}`
}

const MB = 1024 * 1024

/** Human file sizes, id-ID. */
export function formatFileSize(bytes: number): string {
  return bytes >= MB
    ? `${formatNumber(Math.round((bytes / MB) * 10) / 10)} MB`
    : `${formatNumber(Math.max(1, Math.round(bytes / 1024)))} KB`
}

/** Length limits for messages. */
export function formatRange(range: { min: number; max: number }): {
  min: string
  max: string
} {
  return { min: formatNumber(range.min), max: formatNumber(range.max) }
}
