import {
  type FileHandle,
  mkdir,
  open,
  readdir,
  rename,
  rm,
  stat,
  truncate,
} from "node:fs/promises"
import { isIPv4, isIPv6 } from "node:net"
import { dirname, join } from "node:path"
import { and, eq, gt, sql } from "drizzle-orm"
import { fileTypeFromBuffer } from "file-type"
import type { SessionContext, TenantContext } from "../../app/context.ts"
import { database } from "../../db/client.server.ts"
import { sendJob } from "../../db/jobs.server.ts"
import { processGlobal } from "../../db/process-global.ts"
import { evidence, reports } from "../../db/schema/reports.ts"
import { type Tx, withTenant } from "../../db/tenant.server.ts"
import {
  detectedKind,
  evidenceQueue,
  UPLOAD_CLOSED,
  UPLOAD_WINDOW_MS,
} from "../../shared/evidence.ts"
import {
  EVIDENCE_LIMITS,
  type EvidenceKind,
} from "../../shared/report-fields.ts"
import { defaultFilesDir, originalPath, partPath } from "../files.server.ts"
import { withDeadline } from "../http.ts"
import { globalIntakePause } from "../intake.server.ts"

export type UploadDeps = {
  filesDir: string
  now: () => Date
  maxConcurrent: number
  maxPerIp: number
  intakePaused: boolean
  tenantDailyBytes: number
}

export type UploadInput = {
  request: Request
  evidenceId: string
  tenant: TenantContext
  session: SessionContext | null
}

const SNIFF_BYTES = 4100
const MAX_DEADLINE_MS = 15 * 60 * 1000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// tus 1.0 core, no extensions
const TUS_VERSION = "1.0.0"
const OCTETS = "application/offset+octet-stream"
const ALLOW = "POST, PATCH, HEAD, OPTIONS"
const OFFSET = /^\d{1,15}$/
// Grace for a stalled holder
const TAKEOVER_MS = 3000

class UploadError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly headers: Record<string, string> = {},
  ) {
    super(code)
  }
}

function reply(
  status: number,
  body: Record<string, string>,
  headers: Record<string, string> = {},
): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store", ...headers },
  })
}

/** Eight 16-bit groups, or null. */
function ipv6Groups(ip: string): number[] | null {
  let text = ip.replace(/%.*$/, "")
  // IPv4 tail, two groups
  const tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(text)?.[1]
  if (tail) {
    if (!isIPv4(tail)) return null
    const [a = 0, b = 0, c = 0, d = 0] = tail.split(".").map(Number)
    text = `${text.slice(0, -tail.length)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`
  }
  const halves = text.split("::")
  if (halves.length > 2) return null
  const parse = (part: string) => (part ? part.split(":") : [])
  const head = parse(halves[0] ?? "")
  const rest = halves.length === 2 ? parse(halves[1] ?? "") : []
  const fill = 8 - head.length - rest.length
  if (halves.length === 2 ? fill < 1 : fill !== 0) return null
  const groups = [...head, ...Array(Math.max(fill, 0)).fill("0"), ...rest]
  if (!groups.every((g) => /^[0-9a-f]{1,4}$/i.test(g))) return null
  return groups.map((g) => Number.parseInt(g, 16))
}

/** IPv6 /64 or IPv4 address. */
export function clientKey(ip: string | null): string {
  if (!ip) return "unknown"
  if (isIPv4(ip)) return ip
  if (!isIPv6(ip.replace(/%.*$/, ""))) return "unknown"
  const groups = ipv6Groups(ip)
  if (!groups) return "unknown"
  const [g0, g1, g2, g3, g4, g5, g6 = 0, g7 = 0] = groups
  // IPv4-mapped ::ffff:a.b.c.d
  if (
    g0 === 0 &&
    g1 === 0 &&
    g2 === 0 &&
    g3 === 0 &&
    g4 === 0 &&
    g5 === 0xffff
  ) {
    return [g6 >> 8, g6 & 255, g7 >> 8, g7 & 255].join(".")
  }
  return groups
    .slice(0, 4)
    .map((g) => g.toString(16))
    .join(":")
}

const jobs = processGlobal("jobs", (): { ready?: Promise<unknown> } => ({}))

/** Dev never runs server/index.ts. */
export function ensureJobs(): Promise<unknown> {
  jobs.ready ??= database()
    .boss.start()
    .catch((error: unknown) => {
      jobs.ready = undefined
      throw error
    })
  return jobs.ready
}

type Received = { detectedType: string; size: number; sha256: string }

/** Loops over short writes. */
async function writeAll(handle: FileHandle, chunk: Uint8Array): Promise<void> {
  let done = 0
  while (done < chunk.byteLength) {
    const { bytesWritten } = await handle.write(
      chunk,
      done,
      chunk.byteLength - done,
    )
    done += bytesWritten
  }
}

async function streamToFile(
  body: ReadableStream<Uint8Array>,
  path: string,
  expected: { kind: EvidenceKind; limit: number; deadlineMs: number },
): Promise<Received> {
  const { limit, deadlineMs } = expected
  const reader = body.getReader()
  const hasher = new Bun.CryptoHasher("sha256")
  const head: Uint8Array[] = []
  let headSize = 0
  let size = 0
  let detectedType: string | undefined
  // Pool thread, never the loop
  let sink: FileHandle | undefined

  const sniff = async () => {
    const found = await fileTypeFromBuffer(Buffer.concat(head))
    // Row kind from the manifest
    if (!found || detectedKind(found.mime) !== expected.kind) {
      throw new UploadError(415, "unsupported_type")
    }
    detectedType = found.mime
    sink = await open(path, "w")
    for (const chunk of head) await writeAll(sink, chunk)
  }

  const pump = async () => {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) throw new UploadError(413, "too_large")
      hasher.update(value)
      if (detectedType) {
        if (sink) await writeAll(sink, value)
        continue
      }
      head.push(value)
      headSize += value.byteLength
      // Type before writing the rest
      if (headSize >= SNIFF_BYTES) await sniff()
    }
    if (!detectedType) await sniff()
    await sink?.close()
  }

  try {
    await withDeadline(pump(), deadlineMs)
  } catch (error) {
    await reader.cancel().catch(() => {})
    await sink?.close().catch(() => {})
    if (error instanceof UploadError) throw error
    if (error instanceof Error && error.message === "deadline exceeded") {
      throw new UploadError(408, "too_slow")
    }
    throw error
  }
  if (!detectedType) throw new UploadError(415, "unsupported_type")
  return { detectedType, size, sha256: hasher.digest("hex") }
}

type Row = {
  status: string
  kind: EvidenceKind
  declaredSize: number
  byteSize: number | null
  userId: string
  reportStatus: string
  reportCreatedAt: Date
}

type Found = Row & { tenantBytes: number }

/** Row, owner and usage. */
async function findUpload(
  tenantId: string,
  evidenceId: string,
  now: Date,
): Promise<Found | null> {
  return withTenant(
    tenantId,
    async (tx) => {
      const row = await readRow(tx, evidenceId)
      if (!row) return null
      const [usage] = await tx
        .select({
          bytes: sql<number>`coalesce(sum(${evidence.byteSize}), 0)::bigint`,
        })
        .from(evidence)
        .where(
          gt(evidence.receivedAt, new Date(now.getTime() - UPLOAD_WINDOW_MS)),
        )
      return { ...row, tenantBytes: Number(usage?.bytes ?? 0) }
    },
    { role: "reporter" },
  )
}

/** Row and owner, no usage. */
function findRow(tenantId: string, evidenceId: string): Promise<Row | null> {
  return withTenant(tenantId, (tx) => readRow(tx, evidenceId), {
    role: "reporter",
  })
}

async function readRow(tx: Tx, evidenceId: string): Promise<Row | null> {
  const [row] = await tx
    .select({
      status: evidence.status,
      kind: evidence.kind,
      declaredSize: evidence.declaredSize,
      byteSize: evidence.byteSize,
      userId: reports.userId,
      reportStatus: reports.status,
      reportCreatedAt: reports.createdAt,
    })
    .from(evidence)
    .innerJoin(
      reports,
      and(eq(reports.orgId, evidence.orgId), eq(reports.id, evidence.reportId)),
    )
    .where(eq(evidence.id, evidenceId))
    .limit(1)
  return row ?? null
}

/** Window and report state. */
function checkOpen(found: Row, now: Date, closedStatus: number): void {
  // Copy waits at campus B
  if (UPLOAD_CLOSED.includes(found.reportStatus)) {
    throw new UploadError(closedStatus, "report_closed")
  }
  if (now.getTime() - found.reportCreatedAt.getTime() > UPLOAD_WINDOW_MS) {
    throw new UploadError(410, "upload_window_closed")
  }
}

/** Compare-and-set, then rename and enqueue. */
async function commit(
  tenantId: string,
  evidenceId: string,
  kind: EvidenceKind,
  file: Received,
  from: string,
  final: string,
  now: Date,
): Promise<boolean> {
  await ensureJobs()
  return withTenant(
    tenantId,
    async (tx) => {
      // Loser writes nothing
      const updated = await tx
        .update(evidence)
        .set({
          status: "received",
          detectedType: file.detectedType,
          byteSize: file.size,
          sha256: file.sha256,
          receivedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(evidence.id, evidenceId),
            eq(evidence.status, "awaiting_upload"),
          ),
        )
        .returning({ id: evidence.id })
      if (updated.length === 0) return false
      await rename(from, final)
      await sendJob(tx, evidenceQueue(kind), { orgId: tenantId, evidenceId })
      return true
    },
    { role: "reporter" },
  )
}

/** Head bytes must match kind. */
async function sniffFile(
  handle: FileHandle,
  bytes: number,
  kind: EvidenceKind,
): Promise<string> {
  const head = Buffer.alloc(bytes)
  const { bytesRead } = await handle.read(head, 0, bytes, 0)
  const found = await fileTypeFromBuffer(head.subarray(0, bytesRead))
  if (!found || detectedKind(found.mime) !== kind) {
    throw new UploadError(415, "unsupported_type")
  }
  return found.mime
}

/** Sniffs and hashes the part. */
async function readPart(path: string, kind: EvidenceKind): Promise<Received> {
  const handle = await open(path, "r")
  try {
    const { size } = await handle.stat()
    const detectedType = await sniffFile(
      handle,
      Math.min(SNIFF_BYTES, size),
      kind,
    )
    const hasher = new Bun.CryptoHasher("sha256")
    const buffer = Buffer.alloc(1024 * 1024)
    for (let at = 0; at < size; ) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, at)
      if (bytesRead === 0) break
      hasher.update(buffer.subarray(0, bytesRead))
      at += bytesRead
    }
    return { detectedType, size, sha256: hasher.digest("hex") }
  } finally {
    await handle.close()
  }
}

async function sizeOf(path: string): Promise<number> {
  try {
    return (await stat(path)).size
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return 0
    }
    throw error
  }
}

/** Bytes held in started parts. */
async function partBytes(dir: string): Promise<number> {
  let names: string[]
  try {
    names = await readdir(dir)
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return 0
    }
    throw error
  }
  let total = 0
  for (const name of names) {
    if (name.startsWith(".part-")) total += await sizeOf(join(dir, name))
  }
  return total
}

/** Seconds at 64 KB/s, capped. */
function deadlineFor(bytes: number): number {
  return Math.min(MAX_DEADLINE_MS, (bytes / 65_536) * 1000 + 30_000)
}

type Append = {
  start: number
  remaining: number
  length: number
  kind: EvidenceKind
  signal: AbortSignal
}

/** One PATCH, partial bytes kept. */
async function appendPart(
  body: ReadableStream<Uint8Array>,
  path: string,
  opts: Append,
): Promise<number> {
  const threshold = Math.min(SNIFF_BYTES, opts.length)
  const reader = body.getReader()
  const handle = await open(path, "a+")
  let written = 0
  let stop: UploadError | undefined
  const halt = (reason: UploadError) => {
    stop ??= reason
    reader.cancel().catch(() => {})
  }
  const onAbort = () => halt(new UploadError(423, "taken_over"))
  opts.signal.addEventListener("abort", onAbort)
  const timer = setTimeout(
    () => halt(new UploadError(408, "too_slow")),
    deadlineFor(opts.remaining),
  )

  let clientGone = false
  const pump = async () => {
    for (;;) {
      const { done, value } = await reader.read().catch((error: unknown) => {
        clientGone = true
        throw error
      })
      if (done || stop) return
      if (written + value.byteLength > opts.remaining) {
        throw new UploadError(413, "too_large")
      }
      const before = opts.start + written
      await writeAll(handle, value)
      written += value.byteLength
      // Early type check, once
      if (before < threshold && opts.start + written >= threshold) {
        await sniffFile(handle, threshold, opts.kind)
      }
    }
  }

  let failure: unknown
  try {
    await pump()
  } catch (error) {
    failure = error
    await reader.cancel().catch(() => {})
  } finally {
    clearTimeout(timer)
    opts.signal.removeEventListener("abort", onAbort)
    await handle.close()
  }
  if (failure instanceof UploadError && failure.status === 413) {
    // Upload left unchanged
    await truncate(path, opts.start)
    throw failure
  }
  if (failure instanceof UploadError && failure.status === 415) {
    await rm(path, { force: true })
    throw failure
  }
  if (stop) throw stop
  // Client gone, bytes kept
  if (clientGone) throw new UploadError(408, "interrupted")
  // Disk or sniff fault: 500
  if (failure) throw failure
  return opts.start + written
}

type Lock = { controller: AbortController; released: Promise<void> }
type Held = { signal: AbortSignal; release: () => void }

const TUS_HEADERS = {
  "Tus-Resumable": TUS_VERSION,
  "Cache-Control": "private, no-store",
}

function tusReply(
  status: number,
  headers: Record<string, string> = {},
  body: Record<string, string> | null = null,
): Response {
  const all = { ...TUS_HEADERS, ...headers }
  return body
    ? Response.json(body, { status, headers: all })
    : new Response(null, { status, headers: all })
}

/** tus clients may tunnel PATCH. */
function methodOf(request: Request): string {
  const override = request.headers.get("x-http-method-override")
  return request.method === "POST" && override
    ? override.toUpperCase()
    : request.method
}

export function createUploadHandler(deps: UploadDeps) {
  let inFlight = 0
  const perIp = new Map<string, number>()
  const locks = new Map<string, Lock>()

  /** Upload slot, or null. */
  function takeSlot(request: Request): (() => void) | null {
    const ip = clientKey(request.headers.get("x-client-ip"))
    if (
      inFlight >= deps.maxConcurrent ||
      (perIp.get(ip) ?? 0) >= deps.maxPerIp
    ) {
      return null
    }
    inFlight++
    perIp.set(ip, (perIp.get(ip) ?? 0) + 1)
    return () => {
      inFlight--
      const left = (perIp.get(ip) ?? 1) - 1
      if (left > 0) perIp.set(ip, left)
      else perIp.delete(ip)
    }
  }

  /** Stalled holder yields its lock. */
  async function lock(id: string): Promise<Held | null> {
    const held = locks.get(id)
    if (held) {
      held.controller.abort()
      let timer: ReturnType<typeof setTimeout> | undefined
      await Promise.race([
        held.released,
        new Promise((resolve) => {
          timer = setTimeout(resolve, TAKEOVER_MS)
        }),
      ])
      clearTimeout(timer)
      if (locks.has(id)) return null
    }
    const { promise: released, resolve: release } =
      Promise.withResolvers<void>()
    const mine: Lock = { controller: new AbortController(), released }
    locks.set(id, mine)
    return {
      signal: mine.controller.signal,
      release: () => {
        if (locks.get(id) === mine) locks.delete(id)
        release()
      },
    }
  }

  function paths(tenantId: string, evidenceId: string) {
    return {
      final: originalPath(deps.filesDir, tenantId, evidenceId),
      part: partPath(deps.filesDir, tenantId, evidenceId),
    }
  }

  /** Received plus other started bytes. */
  async function checkCap(input: UploadInput, found: Found): Promise<void> {
    const { part } = paths(input.tenant.id, input.evidenceId)
    // Own part may finish
    const others = (await partBytes(dirname(part))) - (await sizeOf(part))
    const used = found.tenantBytes + others
    if (used >= deps.tenantDailyBytes) {
      throw new UploadError(503, "tenant_cap", { "Retry-After": "3600" })
    }
  }

  /** Full part becomes the original. */
  async function finish(
    input: UploadInput,
    kind: EvidenceKind,
    now: Date,
  ): Promise<void> {
    const { tenant, evidenceId } = input
    const { final, part } = paths(tenant.id, evidenceId)
    const file = await readPart(part, kind).catch(async (error: unknown) => {
      if (error instanceof UploadError) await rm(part, { force: true })
      throw error
    })
    const won = await commit(
      tenant.id,
      evidenceId,
      kind,
      file,
      part,
      final,
      now,
    )
    if (!won) await rm(part, { force: true })
  }

  async function receivePost(input: UploadInput): Promise<Response> {
    const { request, evidenceId, tenant, session } = input
    if (!session) return reply(401, { error: "sign_in_required" })
    if (deps.intakePaused || tenant.settings.intakePaused) {
      return reply(503, { error: "intake_paused" })
    }
    if (!UUID.test(evidenceId)) return reply(404, { error: "not_found" })
    const free = takeSlot(request)
    if (!free) return reply(503, { error: "busy" }, { "Retry-After": "30" })

    const { final, part } = paths(tenant.id, evidenceId)
    const dir = dirname(final)
    const temp = join(dir, `.tmp-${evidenceId}-${crypto.randomUUID()}`)
    try {
      const now = deps.now()
      const found = await findUpload(tenant.id, evidenceId, now)
      // Missing and foreign look alike
      if (!found || found.userId !== session.user.id) {
        throw new UploadError(404, "not_found")
      }
      if (found.status !== "awaiting_upload") {
        return reply(200, { status: found.status })
      }
      checkOpen(found, now, 409)
      await checkCap(input, found)
      const limit = Math.min(EVIDENCE_LIMITS[found.kind], found.declaredSize)
      const declared = Number(request.headers.get("content-length") ?? 0)
      if (declared > limit) throw new UploadError(413, "too_large")
      if (!request.body) throw new UploadError(415, "unsupported_type")

      await mkdir(dir, { recursive: true })
      const file = await streamToFile(request.body, temp, {
        kind: found.kind,
        limit,
        deadlineMs: deadlineFor(limit),
      })
      const stored = await commit(
        tenant.id,
        evidenceId,
        found.kind,
        file,
        temp,
        final,
        now,
      )
      if (!stored) return reply(200, { status: "received" })
      // Started resumable copy is moot
      await rm(part, { force: true })
      return reply(201, { status: "received" })
    } catch (error) {
      if (error instanceof UploadError) {
        return reply(error.status, { error: error.code }, error.headers)
      }
      throw error
    } finally {
      await rm(temp, { force: true })
      free()
    }
  }

  /** Offset and length, tus HEAD. */
  async function receiveHead(input: UploadInput): Promise<Response> {
    const { evidenceId, tenant, session } = input
    if (!session) return tusReply(401)
    if (!UUID.test(evidenceId)) return tusReply(404)
    const now = deps.now()
    // PERF-26: no usage read
    const found = await findRow(tenant.id, evidenceId)
    if (!found || found.userId !== session.user.id) return tusReply(404)
    if (found.status === "missing") return tusReply(410)
    if (found.status !== "awaiting_upload") {
      const size = String(found.byteSize ?? found.declaredSize)
      return tusReply(200, { "Upload-Offset": size, "Upload-Length": size })
    }
    try {
      checkOpen(found, now, 403)
    } catch (error) {
      if (error instanceof UploadError) return tusReply(error.status)
      throw error
    }
    const length = found.declaredSize
    const { part } = paths(tenant.id, evidenceId)
    let offset = await sizeOf(part)
    if (offset >= length) {
      // Earlier commit failed, retry
      const held = await lock(evidenceId)
      if (!held) return tusReply(423)
      try {
        // Lock holder may have committed
        const current = await findRow(tenant.id, evidenceId)
        if (!current) return tusReply(404)
        if (current.status === "missing") return tusReply(410)
        if (current.status !== "awaiting_upload") {
          const size = String(current.byteSize ?? current.declaredSize)
          return tusReply(200, { "Upload-Offset": size, "Upload-Length": size })
        }
        offset = await sizeOf(part)
        if (offset >= length) await finish(input, found.kind, now)
      } catch (error) {
        if (!(error instanceof UploadError)) throw error
        offset = 0
      } finally {
        held.release()
      }
    }
    return tusReply(200, {
      "Upload-Offset": String(Math.min(offset, length)),
      "Upload-Length": String(length),
    })
  }

  /** Appends at offset, tus PATCH. */
  async function receivePatch(input: UploadInput): Promise<Response> {
    const { request, evidenceId, tenant, session } = input
    const contentType = request.headers.get("content-type") ?? ""
    if (contentType.split(";")[0]?.trim().toLowerCase() !== OCTETS) {
      return tusReply(415, {}, { error: "unsupported_type" })
    }
    const offsetHeader = request.headers.get("upload-offset") ?? ""
    if (!OFFSET.test(offsetHeader)) {
      return tusReply(400, {}, { error: "bad_offset" })
    }
    const offset = Number(offsetHeader)
    if (!session) return tusReply(401, {}, { error: "sign_in_required" })
    if (deps.intakePaused || tenant.settings.intakePaused) {
      return tusReply(503, {}, { error: "intake_paused" })
    }
    if (!UUID.test(evidenceId)) return tusReply(404, {}, { error: "not_found" })
    const free = takeSlot(request)
    if (!free) {
      return tusReply(503, { "Retry-After": "30" }, { error: "busy" })
    }
    let held: Held | null = null
    try {
      const now = deps.now()
      const found = await findUpload(tenant.id, evidenceId, now)
      if (!found || found.userId !== session.user.id) {
        throw new UploadError(404, "not_found")
      }
      if (found.status === "missing") throw new UploadError(410, "missing")
      if (found.status !== "awaiting_upload") {
        // Done already, lost response
        const size = found.byteSize ?? found.declaredSize
        if (offset !== size) throw new UploadError(409, "offset_mismatch")
        return tusReply(204, { "Upload-Offset": String(size) })
      }
      checkOpen(found, now, 403)
      await checkCap(input, found)
      const length = found.declaredSize
      if (length > EVIDENCE_LIMITS[found.kind]) {
        throw new UploadError(413, "too_large")
      }
      held = await lock(evidenceId)
      if (!held) throw new UploadError(423, "locked")
      const { part } = paths(tenant.id, evidenceId)
      const start = await sizeOf(part)
      if (offset !== start) throw new UploadError(409, "offset_mismatch")
      const remaining = length - start
      const declared = Number(request.headers.get("content-length") ?? 0)
      if (declared > remaining) throw new UploadError(413, "too_large")

      let end = start
      if (request.body && remaining > 0) {
        await mkdir(dirname(part), { recursive: true })
        end = await appendPart(request.body, part, {
          start,
          remaining,
          length,
          kind: found.kind,
          signal: held.signal,
        })
      }
      if (end === length) await finish(input, found.kind, now)
      return tusReply(204, { "Upload-Offset": String(end) })
    } catch (error) {
      if (error instanceof UploadError) {
        return tusReply(error.status, error.headers, { error: error.code })
      }
      throw error
    } finally {
      held?.release()
      free()
    }
  }

  return async function receiveUpload(input: UploadInput): Promise<Response> {
    const method = methodOf(input.request)
    if (method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Tus-Version": TUS_VERSION,
          "Tus-Max-Size": String(EVIDENCE_LIMITS.video),
          "Cache-Control": "private, no-store",
        },
      })
    }
    if (method === "POST") return receivePost(input)
    if (method !== "HEAD" && method !== "PATCH") {
      return new Response(null, {
        status: 405,
        headers: { Allow: ALLOW, "Cache-Control": "private, no-store" },
      })
    }
    if (input.request.headers.get("tus-resumable") !== TUS_VERSION) {
      return new Response(null, {
        status: 412,
        headers: {
          "Tus-Version": TUS_VERSION,
          "Cache-Control": "private, no-store",
        },
      })
    }
    return method === "HEAD" ? receiveHead(input) : receivePatch(input)
  }
}

export const receiveUpload = createUploadHandler({
  filesDir: defaultFilesDir(),
  now: () => new Date(),
  maxConcurrent: 4,
  maxPerIp: 3,
  intakePaused: globalIntakePause(),
  tenantDailyBytes: 10 * 1024 ** 3,
})
