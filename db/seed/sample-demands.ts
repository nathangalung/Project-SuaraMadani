import { rm } from "node:fs/promises"
import { and, asc, eq, inArray, isNotNull, like, sql } from "drizzle-orm"
import {
  changeDemandState,
  createDemand,
  type DemandTenant,
  editItem,
  getManagedDemand,
  linkIssue,
  publishBrief,
  recordItemUpdate,
  uploadBrief,
} from "../../app/features/demands/manage.server.ts"
import { briefPath, cleanBriefPath } from "../../server/files.server.ts"
import { jakartaIsoDate } from "../../shared/format.ts"
import { createBriefScanHandler } from "../../worker/evidence-brief.ts"
import type { Db } from "../client.server.ts"
import { users } from "../schema/auth.ts"
import {
  demandItems,
  demandRankings,
  demands,
  demandUpdates,
  policyBriefs,
} from "../schema/demands.ts"
import { issues } from "../schema/issues.ts"
import { withTenant } from "../tenant.server.ts"
import {
  type PlannedDemand,
  SAMPLE_BRIEF_URL,
  SAMPLE_DEMANDS,
  SAMPLE_MARK,
} from "./sample-demands-content.ts"

const DAY_MS = 86_400_000
const isSample = like(demands.body, `${SAMPLE_MARK}%`)

type Org = {
  id: string
  host: string
  slug: "itb" | "ugm"
  campusCode: string
  actorId: string
}

export type DemandSeedDeps = {
  migrator: Db
  media?: Db
  filesDir: string
  now: Date
}

const daysAgo = (now: Date, days: number) =>
  new Date(now.getTime() - days * DAY_MS)

const PDF_TEXT = /[^\x20-\x7e]/g

/** One page, Helvetica, ASCII only. */
export function textPdf(lines: string[]): Uint8Array {
  const quote = (line: string) =>
    line.replace(PDF_TEXT, "?").replace(/([\\()])/g, "\\$1")
  const content = [
    "BT",
    "/F1 12 Tf",
    "16 TL",
    "72 760 Td",
    ...lines.map((line) => `(${quote(line)}) Tj T*`),
    "ET",
  ].join("\n")
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ]
  let body = "%PDF-1.4\n"
  const offsets: number[] = []
  for (const [index, object] of objects.entries()) {
    offsets.push(body.length)
    body += `${index + 1} 0 obj\n${object}\nendobj\n`
  }
  const xref = body.length
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) {
    body += `${String(offset).padStart(10, "0")} 00000 n \n`
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new TextEncoder().encode(body)
}

/** Wrap lines at 80. */
function wrap(text: string, width = 80): string[] {
  const lines: string[] = []
  let line = ""
  for (const word of text.split(/\s+/)) {
    if (line && `${line} ${word}`.length > width) {
      lines.push(line)
      line = word
    } else {
      line = line ? `${line} ${word}` : word
    }
  }
  if (line) lines.push(line)
  return lines
}

export type DemandSampleState = "empty" | "complete" | "partial"

export async function demandSampleState(org: Org): Promise<DemandSampleState> {
  const planned = SAMPLE_DEMANDS[org.slug].length
  const [row] = await withTenant(org.id, (tx) =>
    tx.select({ n: sql<number>`count(*)::int` }).from(demands).where(isSample),
  )
  const n = row?.n ?? 0
  if (n === 0) return "empty"
  return n === planned ? "complete" : "partial"
}

async function linkIssues(
  tenant: DemandTenant,
  org: Org,
  code: string,
  plan: PlannedDemand,
): Promise<void> {
  if (!plan.issues) return
  const prefix = plan.issues
  const found = await withTenant(org.id, (tx) =>
    tx
      .select({ code: issues.publicCode })
      .from(issues)
      .where(
        and(
          isNotNull(issues.publishedAt),
          like(issues.subcategoryId, `${prefix}%`),
          // Its own region, else nothing
          plan.provinceCode
            ? eq(issues.provinceCode, plan.provinceCode)
            : undefined,
          plan.regencyCode
            ? eq(issues.regencyCode, plan.regencyCode)
            : undefined,
        ),
      )
      .orderBy(asc(issues.publicCode))
      .limit(2),
  )
  for (const issue of found) {
    const linked = await linkIssue(tenant, {
      code,
      issueCode: issue.code,
      actorId: org.actorId,
    })
    if (!linked.ok) throw new Error(`link ${issue.code}: ${linked.reason}`)
  }
}

async function addBriefs(
  tenant: DemandTenant,
  org: Org,
  code: string,
  plan: PlannedDemand,
  deps: DemandSeedDeps,
): Promise<void> {
  const scan = createBriefScanHandler({
    filesDir: deps.filesDir,
    db: deps.media,
    // Generated here, no metadata
    strip: async (bytes) => bytes,
  })
  for (const brief of plan.briefs) {
    const demand = await getManagedDemand(org.id, code)
    const item = demand?.items[brief.item]
    if (!item) throw new Error(`brief item ${brief.item} missing`)
    const pdf = textPdf([
      `${SAMPLE_MARK} Policy brief, bukan dokumen resmi`,
      "",
      ...wrap(plan.title),
      "",
      ...wrap(`Subtuntutan: ${item.body}`),
      "",
      ...wrap(brief.summary),
    ])
    // Summary shows above the link
    const summarized = await editItem(tenant, {
      code,
      itemId: item.id,
      version: item.version,
      body: item.body,
      briefSummary: brief.summary,
      actorId: org.actorId,
    })
    if (!summarized.ok) throw new Error(`brief summary: ${summarized.reason}`)
    const uploaded = await uploadBrief(
      tenant,
      { code, itemId: item.id, bytes: pdf, actorId: org.actorId },
      { filesDir: deps.filesDir },
    )
    if (!uploaded.ok) throw new Error(`brief upload: ${uploaded.reason}`)
    const stored = (await getManagedDemand(org.id, code))?.items[brief.item]
      ?.briefs[0]
    if (!stored) throw new Error("brief row missing")
    const verdict = await scan({ orgId: org.id, briefId: stored.id })
    if (verdict !== "clean") throw new Error(`brief scan: ${verdict}`)
    const published = await publishBrief(tenant, {
      code,
      briefId: stored.id,
      actorId: org.actorId,
    })
    if (!published.ok) throw new Error(`brief publish: ${published.reason}`)
  }
}

/** Real use cases, then backdate. */
async function seedDemand(
  org: Org,
  plan: PlannedDemand,
  deps: DemandSeedDeps,
): Promise<void> {
  const tenant = { id: org.id, host: org.host, campusCode: org.campusCode }
  const created = await createDemand(tenant, {
    fields: {
      scope: plan.scope,
      provinceCode: plan.provinceCode,
      regencyCode: plan.regencyCode,
      category: plan.category,
      title: plan.title,
      body: plan.body,
      summary: plan.summary,
      target: plan.target,
      raisedOn: jakartaIsoDate(daysAgo(deps.now, plan.raisedDaysAgo)),
      briefUrl: plan.briefLinks?.demand ? SAMPLE_BRIEF_URL : null,
    },
    items: plan.items,
    actorId: org.actorId,
    now: deps.now,
  })
  if (!created.ok) throw new Error(`create: ${created.reason}`)
  const { code } = created
  await linkIssues(tenant, org, code, plan)
  for (const index of plan.briefLinks?.items ?? []) {
    const item = (await getManagedDemand(org.id, code))?.items[index]
    if (!item) throw new Error(`brief link item ${index} missing`)
    const linked = await editItem(tenant, {
      code,
      itemId: item.id,
      version: item.version,
      briefUrl: SAMPLE_BRIEF_URL,
      actorId: org.actorId,
    })
    if (!linked.ok) throw new Error(`brief link: ${linked.reason}`)
  }
  if (plan.publishDaysAgo === null) return
  const draft = await getManagedDemand(org.id, code)
  const published = await changeDemandState(tenant, {
    code,
    action: "publish",
    version: draft?.version ?? 0,
    note: null,
    actorId: org.actorId,
    now: daysAgo(deps.now, plan.publishDaysAgo),
  })
  if (!published.ok) throw new Error(`publish: ${published.reason}`)
  await addBriefs(tenant, org, code, plan, deps)
  for (const update of plan.updates) {
    const demand = await getManagedDemand(org.id, code)
    const item = demand?.items[update.item]
    if (!item) throw new Error(`update item ${update.item} missing`)
    const done = await recordItemUpdate(tenant, {
      code,
      itemId: item.id,
      version: item.version,
      to: update.to ?? null,
      occurredOn: jakartaIsoDate(daysAgo(deps.now, update.daysAgo)),
      note: update.note,
      sourceText: update.source,
      sourceUrl: null,
      actorId: org.actorId,
    })
    if (!done.ok) throw new Error(`update ${code}: ${done.reason}`)
  }
  if (plan.close) {
    const open = await getManagedDemand(org.id, code)
    const closed = await changeDemandState(tenant, {
      code,
      action: "close",
      version: open?.version ?? 0,
      note: plan.close.note,
      actorId: org.actorId,
      now: daysAgo(deps.now, plan.close.daysAgo),
    })
    if (!closed.ok) throw new Error(`close: ${closed.reason}`)
  }
  await backdate(org, code, plan, deps)
}

/** Timestamps follow the plan dates. */
async function backdate(
  org: Org,
  code: string,
  plan: PlannedDemand,
  deps: DemandSeedDeps,
): Promise<void> {
  const at = (days: number | null) =>
    days === null ? null : daysAgo(deps.now, days)
  const latest = Math.min(
    plan.publishDaysAgo ?? plan.raisedDaysAgo,
    ...plan.updates.map((u) => u.daysAgo),
    ...plan.briefs.map((b) => b.daysAgo),
    plan.close?.daysAgo ?? Number.POSITIVE_INFINITY,
  )
  await withTenant(
    org.id,
    async (tx) => {
      const [demand] = await tx
        .update(demands)
        .set({
          createdAt: daysAgo(deps.now, plan.raisedDaysAgo),
          publishedAt: at(plan.publishDaysAgo),
          closedAt: at(plan.close?.daysAgo ?? null),
          lastActivityAt: daysAgo(deps.now, latest),
          updatedAt: daysAgo(deps.now, latest),
        })
        .where(eq(demands.publicCode, code))
        .returning({ id: demands.id })
      if (!demand) throw new Error(`backdate ${code}: missing`)
      // Rows dated by their day
      await tx
        .update(demandUpdates)
        .set({
          createdAt: sql`${demandUpdates.occurredOn}::timestamp + interval '10 hours'`,
        })
        .where(eq(demandUpdates.demandId, demand.id))
      const items = await tx
        .select({ id: demandItems.id, position: demandItems.position })
        .from(demandItems)
        .where(eq(demandItems.demandId, demand.id))
      for (const brief of plan.briefs) {
        const item = items.find((row) => row.position === brief.item)
        if (!item) continue
        const day = daysAgo(deps.now, brief.daysAgo)
        await tx
          .update(policyBriefs)
          .set({ createdAt: day, scannedAt: day, publishedAt: day })
          .where(eq(policyBriefs.itemId, item.id))
        // Timeline shows the brief day
        await tx
          .update(demandUpdates)
          .set({ occurredOn: jakartaIsoDate(day), createdAt: day })
          .where(
            and(
              eq(demandUpdates.itemId, item.id),
              eq(demandUpdates.action, "brief"),
            ),
          )
      }
    },
    { db: deps.migrator },
  )
}

/** Idempotent per org. */
export async function seedSampleDemands(
  org: Org,
  deps: DemandSeedDeps,
): Promise<DemandSampleState> {
  const state = await demandSampleState(org)
  if (state === "partial") {
    throw new Error(
      `Sample tuntutan for ${org.slug} are incomplete. Run bun run db:seed:sample --reset, then seed again.`,
    )
  }
  if (state === "empty") {
    // Oldest first, codes follow age
    const plans = [...SAMPLE_DEMANDS[org.slug]].sort(
      (a, b) => b.raisedDaysAgo - a.raisedDaysAgo,
    )
    for (const plan of plans) await seedDemand(org, plan, deps)
    await seedRankings(org, deps)
  }
  return state
}

// Starting Values: sample rankers
const SAMPLE_RANKERS = 24

/** Aged sample accounts, varied lists. */
async function seedRankings(org: Org, deps: DemandSeedDeps): Promise<void> {
  await withTenant(
    org.id,
    async (tx) => {
      const open = await tx
        .select({ id: demands.id })
        .from(demands)
        .where(eq(demands.state, "published"))
        .orderBy(asc(demands.publicCode))
      const people = await tx
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            like(users.email, `sampel.${org.slug}.%`),
            sql`${users.createdAt} <= ${daysAgo(deps.now, 8)}`,
          ),
        )
        .orderBy(asc(users.email))
        .limit(SAMPLE_RANKERS)
      if (open.length === 0) return
      // Earlier codes lean popular
      const rows = people.flatMap((person, i) =>
        open
          .map((demand, j) => ({
            demand,
            weight: (open.length - j) * 3 + ((i * 7 + j * 5) % 11),
          }))
          .toSorted((a, b) => b.weight - a.weight)
          .map(({ demand }, index) => ({
            orgId: org.id,
            userId: person.id,
            demandId: demand.id,
            position: index + 1,
          })),
      )
      if (rows.length > 0) await tx.insert(demandRankings).values(rows)
    },
    { db: deps.migrator },
  )
}

/** Sample tuntutan only, audit stays. */
export async function resetSampleDemands(
  orgId: string,
  deps: { migrator: Db; filesDir: string },
): Promise<number> {
  const removed = await withTenant(
    orgId,
    async (tx) => {
      const rows = await tx
        .select({ id: demands.id, year: demands.year })
        .from(demands)
        .where(isSample)
      if (rows.length === 0) return { ids: [], briefs: [] }
      const ids = rows.map((row) => row.id)
      const briefs = await tx
        .select({ id: policyBriefs.id })
        .from(policyBriefs)
        .innerJoin(demandItems, eq(demandItems.id, policyBriefs.itemId))
        .where(inArray(demandItems.demandId, ids))
      await tx.delete(demands).where(inArray(demands.id, ids))
      // Counter restarts after sample
      await tx.execute(sql`
        DELETE FROM org_counters
        WHERE org_id = ${orgId} AND kind = 'demand'
          AND NOT EXISTS (SELECT 1 FROM demands WHERE org_id = ${orgId})`)
      return { ids, briefs: briefs.map((row) => row.id) }
    },
    { db: deps.migrator },
  )
  for (const id of removed.briefs) {
    await rm(briefPath(deps.filesDir, orgId, id), { force: true })
    await rm(cleanBriefPath(deps.filesDir, orgId, id), { force: true })
  }
  return removed.ids.length
}
