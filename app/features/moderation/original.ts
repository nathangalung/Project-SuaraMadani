// Used by /asli, card

type OriginalFile = {
  status: string
  kind: string
  scanned: boolean
  failureReason: string | null
}

// Never offered for these
const NO_ORIGINAL = new Set(["awaiting_upload", "missing", "rejected_malware"])

/** ASVS V5.4.3: clean scan only. */
export function originalAvailable(file: OriginalFile): boolean {
  return !NO_ORIGINAL.has(file.status) && file.scanned
}

// Sniffed type sets extension
const EXTENSION_BY_TYPE = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/heic", "heic"],
  ["image/heif", "heif"],
  ["application/pdf", "pdf"],
  ["video/mp4", "mp4"],
  ["video/quicktime", "mov"],
  ["video/webm", "webm"],
])
const STEM_MAX = 80

/** Download name, never reporter's extension. */
export function originalFileName(file: {
  declaredName: string
  detectedType: string | null
  position: number
}): string {
  const extension = EXTENSION_BY_TYPE.get(file.detectedType ?? "") ?? "bin"
  const dot = file.declaredName.lastIndexOf(".")
  const stem = (
    dot === -1 ? file.declaredName : file.declaredName.slice(0, dot)
  )
    .replace(/[^A-Za-z0-9 _-]/g, "_")
    .trim()
    .slice(0, STEM_MAX)
  const safe = /[A-Za-z0-9]/.test(stem) ? stem : `bukti-${file.position + 1}`
  return `${safe}.${extension}`
}
