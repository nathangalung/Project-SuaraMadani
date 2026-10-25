// Contact data never logged
const MAX_TEXT = 512

const QUERY_RE = /\?[^\s"'`<>)\]]+/g
const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g
const IPV4_RE = /(?<![\w.])(?:\d{1,3}\.){3}\d{1,3}(?![\w.])/g
const IPV6_RE = /(?<![\w:.])(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}(?![\w:])/gi
const NUMBER_RE = /\+?\d[\d\s().-]{6,}\d/g

function isIpv6(candidate: string): boolean {
  const colons = candidate.split(":").length - 1
  return (
    (candidate.includes("::") || colons >= 3) && /[0-9a-f]/i.test(candidate)
  )
}

function digitCount(text: string): number {
  return text.replace(/\D/g, "").length
}

/** Masks contact data and queries. */
export function scrub(text: string, max = MAX_TEXT): string {
  return text
    .replace(QUERY_RE, "?[query]")
    .replace(EMAIL_RE, "[email]")
    .replace(IPV4_RE, "[ip]")
    .replace(IPV6_RE, (match) => (isIpv6(match) ? "[ip]" : match))
    .replace(NUMBER_RE, (match) =>
      digitCount(match) >= 8 ? "[number]" : match,
    )
    .slice(0, max)
}
