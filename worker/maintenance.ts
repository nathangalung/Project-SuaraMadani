import { readdir, rm, stat } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { and, inArray, like, lt, sql } from "drizzle-orm"
import { type Db, database } from "../db/client.server.ts"
import { sendJobs } from "../db/jobs.server.ts"
import { invitations, sessions, verifications } from "../db/schema/auth.ts"
import { ratings } from "../db/schema/claims.ts"
import {
  demandRankings,
  demandRatings,
  demands,
  policyBriefs,
} from "../db/schema/demands.ts"
import { resolutionClaims } from "../db/schema/issues.ts"
import { emailLog, notifications } from "../db/schema/notifications.ts"
import { organizations } from "../db/schema/organizations.ts"
import { evidence, reports } from "../db/schema/reports.ts"
import { whatsappAuth, whatsappLog } from "../db/schema/whatsapp.ts"
import { withTenant } from "../db/tenant.server.ts"
import {
  briefPath,
  cleanBriefPath,
  defaultFilesDir,
  derivedPath,
  originalPath,
} from "../server/files.server.ts"
import { writeLog } from "../server/log.ts"
import { UPLOAD_WINDOW_MS } from "../shared/evidence.ts"

// /privasi Masa Simpan, Question 3
const DAY_MS = 86_400_000
const REJECTED_KEEP_MS = 90 * DAY_MS
const EMAIL_LOG_KEEP_MS = 30 * DAY_MS
const IP_KEEP_MS = 30 * DAY_MS
// Expired links, then 30 days
const INVITATION_KEEP_MS = 30 * DAY_MS
// In-flight uploads stay safe
const ORPHAN_AGE_MS = DAY_MS
// Job long gone, row stuck
const SENDING_STUCK_MS = 3_600_000
const ID = /^[0-9a-f-]{36}$/
export const LOOKUP_CHUNK = 1000

export type MaintenanceDeps = { filesDir: string; db?: Db; now?: () => Date }

export type MaintenanceResult = {
  missing: number
  rejectedFiles: number
  emailLog: number
  whatsappLog: number
  verifications: number
  whatsappSessions: number
  sessions: number
  ips: number
  invitations: number
  // Hashed IP prefixes on ratings
  ratingPrefixes: number
  orphans: number
  requeued: number
  infectedBriefs: number
}

async function removeFiles(filesDir: string, orgId: string, id: string) {
  await rm(originalPath(filesDir, orgId, id), { force: true })
  await rm(dirname(derivedPath(filesDir, orgId, id)), {
    recursive: true,
    force: true,
  })
}

async function entries(dir: string): Promise<string[]> {
  return readdir(dir).catch(() => [])
}

const BRIEF_FILE = /^([0-9a-f-]{36})\.pdf$/

/** Unknown ids and stale temps. */
async function sweepOrphans(
  dirs: string[],
  idOf: (name: string) => string | null,
  known: (ids: string[]) => Promise<Set<string>>,
  before: number,
): Promise<number> {
  let removed = 0
  for (const dir of dirs) {
    const names = await entries(dir)
    const ids = names.flatMap((name) => idOf(name) ?? [])
    const live = new Set<string>()
    // Postgres caps bind parameters
    for (let at = 0; at < ids.length; at += LOOKUP_CHUNK) {
      for (const id of await known(ids.slice(at, at + LOOKUP_CHUNK))) {
        live.add(id)
      }
    }
    for (const name of names) {
      // Resumable parts age out too
      const temp = name.startsWith(".tmp-") || name.startsWith(".part-")
      const id = idOf(name)
      if (!temp && (!id || live.has(id))) continue
      const info = await stat(join(dir, name)).catch(() => null)
      if (!info || info.mtimeMs >= before) continue
      await rm(join(dir, name), { recursive: true, force: true })
      removed++
    }
  }
  return removed
}

/** Retention, PLAN §7 step 7. */
export function createMaintenanceHandler(
  deps: MaintenanceDeps = { filesDir: defaultFilesDir() },
) {
  const now = deps.now ?? (() => new Date())
  return async (): Promise<MaintenanceResult> => {
    const db = deps.db ?? database().db
    const at = now().getTime()
    const result: MaintenanceResult = {
      missing: 0,
      rejectedFiles: 0,
      emailLog: 0,
      whatsappLog: 0,
      verifications: 0,
      whatsappSessions: 0,
      sessions: 0,
      ips: 0,
      invitations: 0,
      orphans: 0,
      requeued: 0,
      infectedBriefs: 0,
      ratingPrefixes: 0,
    }
    // Auth tables carry no RLS
    result.emailLog = (
      await db
        .delete(emailLog)
        .where(lt(emailLog.createdAt, new Date(at - EMAIL_LOG_KEEP_MS)))
        .returning({ id: emailLog.id })
    ).length
    result.whatsappLog = (
      await db
        .delete(whatsappLog)
        .where(lt(whatsappLog.createdAt, new Date(at - EMAIL_LOG_KEEP_MS)))
        .returning({ id: whatsappLog.id })
    ).length
    // Abandoned codes hold contacts
    result.verifications = (
      await db
        .delete(verifications)
        .where(lt(verifications.expiresAt, new Date(at)))
        .returning({ id: verifications.id })
    ).length
    // Baileys refetches a missing session
    result.whatsappSessions = (
      await db
        .delete(whatsappAuth)
        .where(
          and(
            like(whatsappAuth.key, "session-%"),
            lt(whatsappAuth.updatedAt, new Date(at - EMAIL_LOG_KEEP_MS)),
          ),
        )
        .returning({ key: whatsappAuth.key })
    ).length
    result.sessions = (
      await db
        .delete(sessions)
        .where(lt(sessions.expiresAt, new Date(at)))
        .returning({ id: sessions.id })
    ).length
    // PRIV-08: user agent too
    result.ips = (
      await db
        .update(sessions)
        .set({ ipAddress: null, userAgent: null })
        .where(
          and(
            lt(sessions.createdAt, new Date(at - IP_KEEP_MS)),
            sql`(${sessions.ipAddress} IS NOT NULL OR ${sessions.userAgent} IS NOT NULL)`,
          ),
        )
        .returning({ id: sessions.id })
    ).length
    // Addresses of people never joined
    result.invitations = (
      await db
        .delete(invitations)
        .where(lt(invitations.expiresAt, new Date(at - INVITATION_KEEP_MS)))
        .returning({ id: invitations.id })
    ).length
    const orgs = await db.select({ id: organizations.id }).from(organizations)
    for (const org of orgs) {
      const done = await withTenant(
        org.id,
        async (tx) => {
          const missing = await tx
            .update(evidence)
            .set({ status: "missing", updatedAt: sql`now()` })
            .where(
              and(
                sql`${evidence.status} = 'awaiting_upload'`,
                inArray(
                  evidence.reportId,
                  tx
                    .select({ id: reports.id })
                    .from(reports)
                    .where(
                      lt(reports.createdAt, new Date(at - UPLOAD_WINDOW_MS)),
                    ),
                ),
              ),
            )
            .returning({ id: evidence.id })
          const rejected = await tx
            .delete(evidence)
            .where(
              inArray(
                evidence.reportId,
                tx
                  .select({ id: reports.id })
                  .from(reports)
                  .where(
                    and(
                      sql`${reports.status} = 'rejected'`,
                      lt(reports.updatedAt, new Date(at - REJECTED_KEEP_MS)),
                    ),
                  ),
              ),
            )
            .returning({ id: evidence.id })
          const stuck = await tx
            .update(notifications)
            .set({ status: "pending", claimedAt: null })
            .where(
              and(
                sql`${notifications.status} = 'sending'`,
                lt(notifications.claimedAt, new Date(at - SENDING_STUCK_MS)),
              ),
            )
            .returning({ id: notifications.id })
          // Idempotency key stops doubles
          await sendJobs(
            tx,
            "email-send",
            stuck.map((row) => ({ orgId: org.id, notificationId: row.id })),
          )
          // ClamAV hit, never served
          const infected = await tx
            .delete(policyBriefs)
            .where(sql`${policyBriefs.status} = 'infected'`)
            .returning({ id: policyBriefs.id })
          // Anomaly flag keeps the count
          const cutoff = new Date(at - IP_KEEP_MS)
          await tx.execute(sql`
            UPDATE ${resolutionClaims} c
            SET max_prefix_ratings = GREATEST(coalesce(c.max_prefix_ratings, 0), top.n)
            FROM (
              SELECT claim_id, max(n)::int AS n FROM (
                SELECT claim_id, count(*) AS n FROM ${ratings}
                WHERE client_hash IS NOT NULL AND claim_id IN (
                  SELECT claim_id FROM ${ratings}
                  WHERE client_hash IS NOT NULL AND created_at < ${cutoff}
                )
                GROUP BY claim_id, client_hash
              ) per_prefix GROUP BY claim_id
            ) top
            WHERE c.id = top.claim_id`)
          // Prefix cap needs 30 days
          const prefixes = await tx
            .update(ratings)
            .set({ clientHash: null })
            .where(
              and(
                sql`${ratings.clientHash} IS NOT NULL`,
                lt(ratings.createdAt, cutoff),
              ),
            )
            .returning({ claimId: ratings.claimId })
          // Same rule for rankings
          await tx.execute(sql`
            UPDATE ${demands} d
            SET max_prefix_rankings = GREATEST(coalesce(d.max_prefix_rankings, 0), top.n)
            FROM (
              SELECT demand_id, max(n)::int AS n FROM (
                SELECT demand_id, count(*) AS n FROM ${demandRankings}
                WHERE client_hash IS NOT NULL AND demand_id IN (
                  SELECT demand_id FROM ${demandRankings}
                  WHERE client_hash IS NOT NULL AND updated_at < ${cutoff}
                )
                GROUP BY demand_id, client_hash
              ) per_prefix GROUP BY demand_id
            ) top
            WHERE d.id = top.demand_id`)
          const rankingPrefixes = await tx
            .update(demandRankings)
            .set({ clientHash: null })
            .where(
              and(
                sql`${demandRankings.clientHash} IS NOT NULL`,
                lt(demandRankings.updatedAt, cutoff),
              ),
            )
            .returning({ demandId: demandRankings.demandId })
          // Legacy rows, hash only
          const legacyPrefixes = await tx
            .update(demandRatings)
            .set({ clientHash: null })
            .where(
              and(
                sql`${demandRatings.clientHash} IS NOT NULL`,
                lt(demandRatings.updatedAt, cutoff),
              ),
            )
            .returning({ demandId: demandRatings.demandId })
          return {
            missing: missing.length,
            prefixes:
              prefixes.length + rankingPrefixes.length + legacyPrefixes.length,
            rejected: rejected.map((r) => r.id),
            requeued: stuck.length,
            infected: infected.map((r) => r.id),
          }
        },
        { db },
      )
      result.missing += done.missing
      result.ratingPrefixes += done.prefixes
      result.requeued += done.requeued
      // Rows first, sweep catches crashes
      for (const id of done.rejected)
        await removeFiles(deps.filesDir, org.id, id)
      result.rejectedFiles += done.rejected.length
      for (const id of done.infected) {
        await rm(briefPath(deps.filesDir, org.id, id), { force: true })
        await rm(cleanBriefPath(deps.filesDir, org.id, id), { force: true })
      }
      result.infectedBriefs += done.infected.length
      const root = resolve(deps.filesDir)
      result.orphans += await sweepOrphans(
        [join(root, "evidence", org.id), join(root, "derived", org.id)],
        (name) => (ID.test(name) ? name : null),
        async (ids) => {
          if (ids.length === 0) return new Set()
          const rows = await withTenant(
            org.id,
            (tx) =>
              tx
                .select({ id: evidence.id })
                .from(evidence)
                .where(inArray(evidence.id, ids)),
            { db },
          )
          return new Set(rows.map((row) => row.id))
        },
        at - ORPHAN_AGE_MS,
      )
      // Briefs whose rows went
      result.orphans += await sweepOrphans(
        [
          join(root, "evidence", "briefs", org.id),
          join(root, "derived", "briefs", org.id),
        ],
        (name) => BRIEF_FILE.exec(name)?.[1] ?? null,
        async (ids) => {
          if (ids.length === 0) return new Set()
          const rows = await withTenant(
            org.id,
            (tx) =>
              tx
                .select({ id: policyBriefs.id })
                .from(policyBriefs)
                .where(inArray(policyBriefs.id, ids)),
            { db },
          )
          return new Set(rows.map((row) => row.id))
        },
        at - ORPHAN_AGE_MS,
      )
    }
    writeLog({ msg: "maintenance done", ...result })
    return result
  }
}
