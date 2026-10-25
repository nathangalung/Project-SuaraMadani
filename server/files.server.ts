import { join, resolve } from "node:path"

// Shared by upload, worker, moderation

export function defaultFilesDir(): string {
  return process.env.FILES_DIR ?? "./.files"
}

/** Private original, never public. */
export function originalPath(
  filesDir: string,
  orgId: string,
  evidenceId: string,
): string {
  return join(resolve(filesDir), "evidence", orgId, evidenceId)
}

/** Resumable bytes, swept daily. */
export function partPath(
  filesDir: string,
  orgId: string,
  evidenceId: string,
): string {
  return join(resolve(filesDir), "evidence", orgId, `.part-${evidenceId}`)
}

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/

/** Staff brief, served after scan. */
export function briefPath(
  filesDir: string,
  orgId: string,
  briefId: string,
): string {
  if (!UUID.test(orgId) || !UUID.test(briefId)) {
    throw new Error("bad brief id")
  }
  return join(resolve(filesDir), "evidence", "briefs", orgId, `${briefId}.pdf`)
}

/** Public brief copy, metadata stripped. */
export function cleanBriefPath(
  filesDir: string,
  orgId: string,
  briefId: string,
): string {
  if (!UUID.test(orgId) || !UUID.test(briefId)) {
    throw new Error("bad brief id")
  }
  return join(resolve(filesDir), "derived", "briefs", orgId, `${briefId}.pdf`)
}

/** Private previews of one file. */
function derivedDir(
  filesDir: string,
  orgId: string,
  evidenceId: string,
): string {
  return join(resolve(filesDir), "derived", orgId, evidenceId)
}

// Page images, video and poster
const DERIVED_NAME = /^(?:\d{1,2}\.webp|video\.mp4)$/

/** Preview file, page index name. */
export function derivedPath(
  filesDir: string,
  orgId: string,
  evidenceId: string,
  name = "0.webp",
): string {
  if (!DERIVED_NAME.test(name)) throw new Error(`bad derived name: ${name}`)
  return join(derivedDir(filesDir, orgId, evidenceId), name)
}

const HOST = /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/
// Content hash names only
export const PUBLIC_MEDIA_NAME = /^[0-9a-f]{64}\.(?:webp|mp4)$/

/** Caddy serves this, item 14. */
export function publicMediaPath(
  filesDir: string,
  host: string,
  name: string,
): string {
  if (!HOST.test(host) || host.includes("..")) {
    throw new Error("bad tenant host")
  }
  if (!PUBLIC_MEDIA_NAME.test(name)) throw new Error("bad media name")
  return join(resolve(filesDir), "public", host, "media", name)
}
