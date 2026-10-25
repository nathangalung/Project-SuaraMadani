// Never cached, never tracked
const PRIVATE_PATHS = [
  /^\/lapor(\/|$)/,
  /^\/lacak(\/|$)/,
  /^\/masuk(\/|$)/,
  /^\/isu\/[^/]+\/laporkan(\/|$)/,
  /^\/isu\/[^/]+\/berhenti(\/|$)/,
  /^\/isu\/[^/]+\/(?:nilai|survei|hak-jawab)(\/|$)/,
  /^\/tuntutan\/[^/]+\/laporkan(\/|$)/,
  /^\/tuntutan\/[^/]+\/nilai(\/|$)/,
  /^\/tuntutan\/[^/]+\/berhenti(\/|$)/,
  /^\/aduan(\/|$)/,
  /^\/undangan(\/|$)/,
  /^\/kelola(\/|$)/,
  /^\/admin(\/|$)/,
  // Public data API is cacheable
  /^\/api\/(?!v1(?:\/|$))/,
  /^\/healthz(\/|$)/,
]

/** Cache rule and tracker skip. */
export function isPrivatePath(path: string): boolean {
  return PRIVATE_PATHS.some((re) => re.test(path))
}

type TrackerPayload = { url?: string; referrer?: string }

// Any host, codes ride paths
function isPrivateUrl(value: string): boolean {
  try {
    return isPrivatePath(new URL(value, "https://x.invalid").pathname)
  } catch {
    // Unparsed: fail closed
    return true
  }
}

/** Umami before-send, every send type. */
export function scrubTrackerPayload<T extends TrackerPayload>(
  _type: string,
  payload: T | null | undefined,
): T | null {
  if (!payload) return null
  if (payload.url && isPrivateUrl(payload.url)) return null
  if (payload.referrer && isPrivateUrl(payload.referrer)) {
    return { ...payload, referrer: "" }
  }
  return payload
}
