import { eq, sql } from "drizzle-orm"
import { type Db, database } from "./client.server.ts"
import type { MemberRole } from "./schema/auth.ts"
import {
  type CounterKind,
  organizations,
  orgCounters,
} from "./schema/organizations.ts"

export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0]

export type TenantOptions = {
  role?: MemberRole
  db?: Db
  now?: () => number
  // One snapshot for all reads
  isolationLevel?: "repeatable read"
}

// Random public codes retry
const CODE_CONSTRAINTS = new Set([
  "reports_org_id_public_code_key",
  "content_complaints_public_code_key",
])
const MAX_CODE_ATTEMPTS = 3
const MAX_DEADLOCK_RETRIES = 1
// Caddy minus transaction minus margin
const RETRY_BUDGET_MS = 10_000

type PgError = { code?: string; constraint?: string }

/** Unwraps DrizzleQueryError causes. */
export function pgError(error: unknown): PgError | undefined {
  let current: unknown = error
  for (let depth = 0; depth < 3 && current; depth++) {
    if (typeof current === "object" && "code" in current) {
      return current as PgError
    }
    current = (current as { cause?: unknown }).cause
  }
  return undefined
}

function retryReason(error: unknown): "code" | "deadlock" | undefined {
  const pg = pgError(error)
  if (
    pg?.code === "23505" &&
    pg.constraint !== undefined &&
    CODE_CONSTRAINTS.has(pg.constraint)
  ) {
    return "code"
  }
  if (pg?.code === "40P01") return "deadlock"
  return undefined
}

/** Sole tenant entry, fn reruns. */
export async function withTenant<T>(
  orgId: string,
  fn: (tx: Tx) => Promise<T>,
  options: TenantOptions = {},
): Promise<T> {
  const db = options.db ?? database().db
  const now = options.now ?? Date.now
  const started = now()
  let codeAttempts = 0
  let deadlocks = 0
  for (;;) {
    try {
      return await db.transaction(async (tx) => {
        await tx.execute(
          sql`select set_config('app.org_id', ${orgId}, true), set_config('app.member_role', ${options.role ?? ""}, true)`,
        )
        return fn(tx)
      }, options.isolationLevel && { isolationLevel: options.isolationLevel })
    } catch (error) {
      const reason = retryReason(error)
      if (reason === "code") codeAttempts++
      if (reason === "deadlock") deadlocks++
      const allowed =
        (reason === "code" && codeAttempts < MAX_CODE_ATTEMPTS) ||
        (reason === "deadlock" && deadlocks <= MAX_DEADLOCK_RETRIES)
      if (!allowed || now() - started >= RETRY_BUDGET_MS) throw error
    }
  }
}

/** Gapless, rolls back with tx. */
export async function nextCounter(
  tx: Tx,
  orgId: string,
  year: number,
  kind: CounterKind,
): Promise<number> {
  const [row] = await tx
    .insert(orgCounters)
    .values({ orgId, year, kind, next: 1 })
    .onConflictDoUpdate({
      target: [orgCounters.orgId, orgCounters.year, orgCounters.kind],
      set: { next: sql`${orgCounters.next} + 1` },
    })
    .returning({ next: orgCounters.next })
  if (!row) throw new Error("Counter not returned")
  return row.next
}

export type Tenant = Pick<
  typeof organizations.$inferSelect,
  | "id"
  | "slug"
  | "host"
  | "name"
  | "campusCode"
  | "campusName"
  | "contactEmail"
  | "theme"
  | "settings"
  | "logoHash"
>

const TENANT_TTL_MS = 60_000
const cache = new Map<string, { tenant: Tenant; expires: number }>()

/** Lowercase, strip port and dot. */
export function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "")
}

/** Own process sees changes now. */
export function forgetTenant(host: string): void {
  cache.delete(normalizeHost(host))
}

/** Unknown hosts are not cached. */
export async function getTenantByHost(
  host: string,
  options: { db?: Db; now?: () => number } = {},
): Promise<Tenant | undefined> {
  const key = normalizeHost(host)
  const now = (options.now ?? Date.now)()
  const hit = cache.get(key)
  if (hit && hit.expires > now) return hit.tenant
  const db = options.db ?? database().db
  const [tenant] = await db
    .select({
      id: organizations.id,
      slug: organizations.slug,
      host: organizations.host,
      name: organizations.name,
      campusCode: organizations.campusCode,
      campusName: organizations.campusName,
      contactEmail: organizations.contactEmail,
      theme: organizations.theme,
      settings: organizations.settings,
      logoHash: organizations.logoHash,
    })
    .from(organizations)
    .where(eq(organizations.host, key))
    .limit(1)
  if (!tenant) {
    cache.delete(key)
    return undefined
  }
  cache.set(key, { tenant, expires: now + TENANT_TTL_MS })
  return tenant
}
