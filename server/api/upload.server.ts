import { mkdir, rename, rm } from "node:fs/promises"
import { isIPv4, isIPv6 } from "node:net"
import { dirname, join } from "node:path"
import { and, eq, gt, sql } from "drizzle-orm"
import { fileTypeFromBuffer } from "file-type"
import type { SessionContext, TenantContext } from "../../app/context.ts"
import { database } from "../../db/client.server.ts"
import { sendJob } from "../../db/jobs.server.ts"
import { evidence, reports } from "../../db/schema/reports.ts"
import { withTenant } from "../../db/tenant.server.ts"
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
import { defaultFilesDir, originalPath } from "../files.server.ts"
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

let jobsReady: Promise<unknown> | undefined

/** Dev never runs server/index.ts. */
export function ensureJobs(): Promise<unknown> {
  jobsReady ??= database()
    .boss.start()
    .catch((error: unknown) => {
      jobsReady = undefined
      throw error
    })
  return jobsReady
}

type Received = { detectedType: string; size: number; sha256: string }

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
  let sink: ReturnType<ReturnType<typeof Bun.file>["writer"]> | undefined

  const sniff = async () => {
    const found = await fileTypeFromBuffer(Buffer.concat(head))
    // Row kind from the manifest
    if (!found || detectedKind(found.mime) !== expected.kind) {
      throw new UploadError(415, "unsupported_type")
    }
    detectedType = found.mime
    sink = Bun.file(path).writer()
    for (const chunk of head) sink.write(chunk)
  }

  const pump = async () => {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) throw new UploadError(413, "too_large")
      hasher.update(value)
      if (detectedType) {
        sink?.write(value)
        continue
      }
      head.push(value)
      headSize += value.byteLength
      // Type before writing the rest
      if (headSize >= SNIFF_BYTES) await sniff()
    }
    if (!detectedType) await sniff()
    await sink?.end()
  }

  try {
    await withDeadline(pump(), deadlineMs)
  } catch (error) {
    await reader.cancel().catch(() => {})
    await sink?.end()
    if (error instanceof UploadError) throw error
    if (error instanceof Error && error.message === "deadline exceeded") {
      throw new UploadError(408, "too_slow")
    }
    throw error
  }
  if (!detectedType) throw new UploadError(415, "unsupported_type")
  return { detectedType, size, sha256: hasher.digest("hex") }
}

export function createUploadHandler(deps: UploadDeps) {
  let inFlight = 0
  const perIp = new Map<string, number>()

  return async function receiveUpload(input: UploadInput): Promise<Response> {
    const { request, evidenceId, tenant, session } = input
    if (!session) return reply(401, { error: "sign_in_required" })
    if (deps.intakePaused || tenant.settings.intakePaused) {
      return reply(503, { error: "intake_paused" })
    }
    if (!UUID.test(evidenceId)) return reply(404, { error: "not_found" })

    const ip = clientKey(request.headers.get("x-client-ip"))
    if (
      inFlight >= deps.maxConcurrent ||
      (perIp.get(ip) ?? 0) >= deps.maxPerIp
    ) {
      return reply(503, { error: "busy" }, { "Retry-After": "30" })
    }
    inFlight++
    perIp.set(ip, (perIp.get(ip) ?? 0) + 1)

    const final = originalPath(deps.filesDir, tenant.id, evidenceId)
    const dir = dirname(final)
    const temp = join(dir, `.tmp-${evidenceId}-${crypto.randomUUID()}`)
    try {
      const now = deps.now()
      const found = await withTenant(
        tenant.id,
        async (tx) => {
          const [row] = await tx
            .select({
              status: evidence.status,
              kind: evidence.kind,
              declaredSize: evidence.declaredSize,
              userId: reports.userId,
              reportStatus: reports.status,
              reportCreatedAt: reports.createdAt,
            })
            .from(evidence)
            .innerJoin(
              reports,
              and(
                eq(reports.orgId, evidence.orgId),
                eq(reports.id, evidence.reportId),
              ),
            )
            .where(eq(evidence.id, evidenceId))
            .limit(1)
          const [usage] = await tx
            .select({
              bytes: sql<number>`coalesce(sum(${evidence.byteSize}), 0)::bigint`,
            })
            .from(evidence)
            .where(
              gt(
                evidence.receivedAt,
                new Date(now.getTime() - UPLOAD_WINDOW_MS),
              ),
            )
          return row ? { ...row, tenantBytes: Number(usage?.bytes ?? 0) } : null
        },
        { role: "reporter" },
      )
      // Missing and foreign look alike
      if (!found || found.userId !== session.user.id) {
        throw new UploadError(404, "not_found")
      }
      if (found.status !== "awaiting_upload") {
        return reply(200, { status: found.status })
      }
      // Copy waits at campus B
      if (UPLOAD_CLOSED.includes(found.reportStatus)) {
        throw new UploadError(409, "report_closed")
      }
      if (now.getTime() - found.reportCreatedAt.getTime() > UPLOAD_WINDOW_MS) {
        throw new UploadError(410, "upload_window_closed")
      }
      if (found.tenantBytes >= deps.tenantDailyBytes) {
        throw new UploadError(503, "tenant_cap", { "Retry-After": "3600" })
      }
      const limit = Math.min(EVIDENCE_LIMITS[found.kind], found.declaredSize)
      const declared = Number(request.headers.get("content-length") ?? 0)
      if (declared > limit) throw new UploadError(413, "too_large")
      if (!request.body) throw new UploadError(415, "unsupported_type")

      await mkdir(dir, { recursive: true })
      const deadlineMs = Math.min(
        MAX_DEADLINE_MS,
        (limit / 65_536) * 1000 + 30_000,
      )
      const file = await streamToFile(request.body, temp, {
        kind: found.kind,
        limit,
        deadlineMs,
      })
      await ensureJobs()
      const stored = await withTenant(
        tenant.id,
        async (tx) => {
          // Compare-and-set, loser writes nothing
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
          await rename(temp, final)
          await sendJob(tx, evidenceQueue(found.kind), {
            orgId: tenant.id,
            evidenceId,
          })
          return true
        },
        { role: "reporter" },
      )
      return stored
        ? reply(201, { status: "received" })
        : reply(200, { status: "received" })
    } catch (error) {
      if (error instanceof UploadError) {
        return reply(error.status, { error: error.code }, error.headers)
      }
      throw error
    } finally {
      await rm(temp, { force: true })
      inFlight--
      const left = (perIp.get(ip) ?? 1) - 1
      if (left > 0) perIp.set(ip, left)
      else perIp.delete(ip)
    }
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
