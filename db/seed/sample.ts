import { createHash } from "node:crypto"
import { mkdir, rm, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { and, eq, inArray, like, type SQL, sql } from "drizzle-orm"
import sharp from "sharp"
import { runPublish } from "../../app/features/issues/publish.server.ts"
import { decideEvidence } from "../../app/features/moderation/evidence.server.ts"
import { runMerge } from "../../app/features/moderation/merge.server.ts"
import {
  applyIssueAction,
  type IssueActionInput,
} from "../../app/features/moderation/referrals.server.ts"
import {
  type ReviewDecision,
  reviewReport,
} from "../../app/features/moderation/verify.server.ts"
import {
  defaultFilesDir,
  derivedPath,
  originalPath,
  publicMediaPath,
} from "../../server/files.server.ts"
import type { PublicMedia } from "../../shared/evidence.ts"
import { jakartaMonth, jakartaYear } from "../../shared/format.ts"
import { isReferralChannel, isRejectReason } from "../../shared/moderation.ts"
import { AGE_CONSENT_VERSION } from "../../shared/report-fields.ts"
import { formatReportCode } from "../../shared/report-id.ts"
import { INITIAL_ISSUE_STATE, type ReportStatus } from "../../shared/status.ts"
import { refreshDashboards } from "../../worker/aggregates.ts"
import { createEvidenceHandler } from "../../worker/evidence.ts"
import { createPublishHandler } from "../../worker/evidence-publish.ts"
import { createVideoHandler } from "../../worker/evidence-video.ts"
import { simplePdf, videoFixture } from "../../worker/fixtures.ts"
import { localStore } from "../../worker/media-store.ts"
import {
  createDatabase,
  type Db,
  database,
  initDatabase,
} from "../client.server.ts"
import { auditLog } from "../schema/audit.ts"
import { members, users } from "../schema/auth.ts"
import { issueReports, issues } from "../schema/issues.ts"
import { takedowns } from "../schema/moderation.ts"
import { follows } from "../schema/notifications.ts"
import { organizations, orgCounters } from "../schema/organizations.ts"
import { regions } from "../schema/regions.ts"
import { evidence, reports } from "../schema/reports.ts"
import { withTenant } from "../tenant.server.ts"
import { SAMPLE_REGIONS } from "./sample-content.ts"
import {
  type DemandSampleState,
  resetSampleDemands,
  seedSampleDemands,
} from "./sample-demands.ts"
import {
  buildSamplePlan,
  type PlannedIssue,
  type PlannedReport,
  type PlannedStep,
  SAMPLE_EMAIL_PATTERN,
  SAMPLE_PROFILES,
  type SamplePlan,
  seededRandom,
} from "./sample-plan.ts"

const DEV_HOSTS = new Set(["localhost", "127.0.0.1"])
const IMAGE = { width: 960, height: 720 }

/** Throws unless clearly local dev. */
export function assertDevTarget(input: {
  nodeEnv: string | undefined
  urls: readonly (string | undefined)[]
}): void {
  if (input.nodeEnv === "production") {
    throw new Error("Sample seed refuses NODE_ENV=production")
  }
  for (const url of input.urls) {
    if (!url) throw new Error("Sample seed needs every database URL set")
    const host = new URL(url).hostname
    if (!DEV_HOSTS.has(host)) {
      throw new Error(`Sample seed refuses database host ${host}`)
    }
  }
}

export type SampleDeps = {
  // Owner role, regions and backdating
  migrator: Db
  // Evidence job role, else app
  media?: Db
  filesDir?: string
  now?: Date
  log?: (line: Record<string, unknown>) => void
}

type Org = {
  id: string
  host: string
  slug: keyof typeof SAMPLE_PROFILES
  campusCode: string
  actorId: string
}

const isSampleUser = like(users.email, SAMPLE_EMAIL_PATTERN)

const iso = (date: Date) => date.toISOString()

/** Abstract pattern, no people. */
export async function abstractImage(seed: string): Promise<Buffer> {
  const random = seededRandom(seed)
  const { width, height } = IMAGE
  const palette = [
    [23, 107, 255],
    [241, 55, 166],
    [168, 239, 226],
    [243, 243, 166],
    [15, 73, 212],
    [236, 230, 210],
  ] as const
  // Three distinct palette colours
  const first = Math.floor(random() * palette.length)
  const step = 1 + Math.floor(random() * 2)
  const color = (k: number) =>
    palette[(first + k * step) % palette.length] ?? [0, 0, 0]
  const [a, b, c] = [color(0), color(1), color(2)]
  const angle = random() * Math.PI
  const [dx, dy] = [Math.cos(angle), Math.sin(angle)]
  const reach = Math.abs(dx) * width + Math.abs(dy) * height
  const circles = Array.from({ length: 4 }, () => ({
    x: random() * width,
    y: random() * height,
    r: 80 + random() * 220,
  }))
  const raw = new Uint8Array(width * height * 3)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const t = ((x - width / 2) * dx + (y - height / 2) * dy) / reach + 0.5
      let mix = 0
      for (const circle of circles) {
        const d = Math.hypot(x - circle.x, y - circle.y)
        mix = Math.max(mix, Math.max(0, 1 - d / circle.r) * 0.75)
      }
      const band = Math.sin((x + y) / 24) > 0.85 ? 0.08 : 0
      const at = (y * width + x) * 3
      for (let k = 0; k < 3; k++) {
        const base = (a[k] ?? 0) * (1 - t) + (b[k] ?? 0) * t
        const value = base * (1 - mix) + (c[k] ?? 0) * mix
        raw[at + k] = Math.round(Math.min(255, value * (1 - band) + 255 * band))
      }
    }
  }
  return sharp(raw, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 82 })
    .toBuffer()
}

async function seedSampleRegions(migrator: Db): Promise<void> {
  // Parents first, row by row
  for (const [code, parent, name] of SAMPLE_REGIONS) {
    await migrator
      .insert(regions)
      .values({
        code,
        parentCode: parent,
        level: code.split(".").length,
        name,
      })
      .onConflictDoUpdate({ target: regions.code, set: { name } })
  }
}

async function loadOrgs(): Promise<Org[]> {
  const db = database().db
  const found: Org[] = []
  for (const profile of Object.values(SAMPLE_PROFILES)) {
    const [org] = await db
      .select({ id: organizations.id, host: organizations.host })
      .from(organizations)
      .where(eq(organizations.slug, profile.slug))
    const [staff] = org
      ? await db
          .select({ id: members.userId })
          .from(members)
          .where(
            and(
              eq(members.organizationId, org.id),
              // Oldest seeded admin acts
              eq(members.role, "admin"),
            ),
          )
          .orderBy(members.createdAt, members.userId)
          .limit(1)
      : []
    if (!org || !staff) {
      throw new Error(
        `Org ${profile.slug} or its admin is missing. Run bun db/seed/regions.ts and bun db/seed/organizations.ts first.`,
      )
    }
    found.push({
      id: org.id,
      host: org.host,
      slug: profile.slug,
      campusCode: profile.campusCode,
      actorId: staff.id,
    })
  }
  return found
}

type SampleState = "empty" | "complete" | "partial"

async function sampleState(org: Org, plan: SamplePlan): Promise<SampleState> {
  const [row] = await withTenant(org.id, async (tx) => {
    const result = await tx.execute<{
      reports: number
      links: number
      fresh: number
      matched: number
      published: number
      moved: number
      follows: number
      orphans: number
    }>(sql`
      SELECT count(*)::int AS reports,
        count(ir.report_id)::int AS links,
        count(*) FILTER (WHERE r.created_at > now() - interval '1 hour')::int AS fresh,
        count(*) FILTER (WHERE r.submission_id IN (${values(plan.reports.map((r) => sql`${r.submissionId}::uuid`))}))::int AS matched,
        (SELECT count(DISTINCT i.id)::int FROM issues i
          JOIN issue_reports l ON l.issue_id = i.id
          JOIN reports s ON s.id = l.report_id
          JOIN users su ON su.id = s.user_id
          WHERE su.email LIKE ${SAMPLE_EMAIL_PATTERN}
            AND i.published_at IS NOT NULL) AS published,
        (SELECT count(DISTINCT i.id)::int FROM issues i
          JOIN issue_reports l ON l.issue_id = i.id
          JOIN reports s ON s.id = l.report_id
          JOIN users su ON su.id = s.user_id
          WHERE su.email LIKE ${SAMPLE_EMAIL_PATTERN}
            AND (i.advocacy_status, i.gov_status) <> (${INITIAL_ISSUE_STATE.advocacy}, ${INITIAL_ISSUE_STATE.government})) AS moved,
        (SELECT count(*)::int FROM follows f
          JOIN users fu ON fu.id = f.user_id
          WHERE fu.email LIKE ${SAMPLE_EMAIL_PATTERN}) AS follows,
        (SELECT count(*)::int FROM follows f
          WHERE NOT EXISTS (SELECT 1 FROM members m
            WHERE m.organization_id = f.org_id AND m.user_id = f.user_id)) AS orphans
      FROM reports r
      JOIN users u ON u.id = r.user_id
      LEFT JOIN issue_reports ir ON ir.org_id = r.org_id AND ir.report_id = r.id
      WHERE u.email LIKE ${SAMPLE_EMAIL_PATTERN}
        AND r.forwarded_from_report_id IS NULL`)
    return result.rows
  })
  if (!row || row.reports === 0) return "empty"
  const merged = plan.reports.filter((r) => r.issue !== null).length
  const published = plan.issues.filter((i) => i.publishedAt).length
  const moved = plan.issues.filter(
    (i) =>
      i.state.advocacy !== INITIAL_ISSUE_STATE.advocacy ||
      i.state.government !== INITIAL_ISSUE_STATE.government,
  ).length
  // Merge makes reporters follow
  const reporterFollows = new Set(
    plan.reports.flatMap((r) =>
      r.issue === null ? [] : [`${r.issue}:${r.reporter}`],
    ),
  ).size
  const complete =
    row.follows === reporterFollows + plan.follows.length &&
    row.orphans === 0 &&
    row.reports === plan.reports.length &&
    row.links === merged &&
    row.published === published &&
    row.moved === moved &&
    row.fresh === 0 &&
    // Same plan version
    row.matched === plan.reports.length
  return complete ? "complete" : "partial"
}

const SAMPLE_ACCOUNT = /^sampel\.([a-z]+)\.(\d+)@/
const ORG_DIGIT: Record<string, string> = { itb: "1", ugm: "2" }

/** Fictional +62 8110 block. */
function samplePhone(email: string): string {
  const [, slug = "", n = ""] = SAMPLE_ACCOUNT.exec(email) ?? []
  const digit = ORG_DIGIT[slug]
  if (!digit) throw new Error(`no sample number for ${email}`)
  return `+628110${digit}${n.padStart(6, "0")}`
}

/** Marked sample, never a person. */
function sampleName(email: string): string {
  const [, slug = "", n = ""] = SAMPLE_ACCOUNT.exec(email) ?? []
  return `Warga ${n} Sampel ${slug.toUpperCase()}`
}

async function insertReporters(plan: SamplePlan): Promise<string[]> {
  const db = database().db
  await db
    .insert(users)
    .values(
      plan.reporters.map((r) => ({
        name: sampleName(r.email),
        email: r.email,
        emailVerified: true,
        phoneNumber: samplePhone(r.email),
        phoneVerified: true,
        createdAt: r.createdAt,
        updatedAt: r.createdAt,
        // 18+ statement, Question 7
        ageDeclaredAt: r.createdAt,
        ageConsentVersion: AGE_CONSENT_VERSION,
      })),
    )
    // Older seeds left numbers unproven
    .onConflictDoUpdate({
      target: users.email,
      set: { phoneVerified: true },
      setWhere: sql`${users.phoneNumber} IS NOT NULL`,
    })
  const rows = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(
      inArray(
        users.email,
        plan.reporters.map((r) => r.email),
      ),
    )
  const byEmail = new Map(rows.map((row) => [row.email, row.id]))
  return plan.reporters.map((r) => {
    const id = byEmail.get(r.email)
    if (!id) throw new Error(`reporter ${r.email} missing`)
    return id
  })
}

type Images = Map<number, Buffer>

// Real names a reporter picks
const EXTRA_FILES = {
  pdf: {
    kind: "pdf",
    name: "surat-balasan-kelurahan.pdf",
    type: "application/pdf",
  },
  video: { kind: "video", name: "rekaman-lokasi.mp4", type: "video/mp4" },
  pending: { kind: "image", name: "foto-tambahan.jpg", type: "image/jpeg" },
} as const
// Declared, never uploaded
const PENDING_SIZE = 245_760

type ExtraBytes = Record<"pdf" | "video", Uint8Array>

/** Made once, sizes must match. */
async function extraBytes(): Promise<ExtraBytes> {
  return {
    pdf: simplePdf(2),
    video: await videoFixture({ width: 320, height: 240, seconds: 2 }),
  }
}

/** Mirrors the step-7 insert. */
async function insertReports(
  org: Org,
  plan: SamplePlan,
  userIds: string[],
  images: Images,
  extras: ExtraBytes,
): Promise<string[]> {
  return withTenant(
    org.id,
    async (tx) => {
      // Plan codes follow live counters
      const taken = await tx
        .select({
          year: orgCounters.year,
          month: orgCounters.month,
          next: orgCounters.next,
        })
        .from(orgCounters)
        .where(
          and(eq(orgCounters.orgId, org.id), eq(orgCounters.kind, "report")),
        )
      const offset = new Map(taken.map((c) => [`${c.year}-${c.month}`, c.next]))
      const top = new Map<string, { year: number; month: number; n: number }>()
      for (const r of plan.reports) {
        const year = jakartaYear(r.createdAt)
        const month = jakartaMonth(r.createdAt)
        const key = `${year}-${month}`
        const n = Number(r.code.slice(-4)) + (offset.get(key) ?? 0)
        r.code = formatReportCode(year, month, n)
        if (n > (top.get(key)?.n ?? 0)) top.set(key, { year, month, n })
      }
      for (const { year, month, n } of top.values()) {
        await tx
          .insert(orgCounters)
          .values({ orgId: org.id, year, month, kind: "report", next: n })
          .onConflictDoUpdate({
            target: [
              orgCounters.orgId,
              orgCounters.year,
              orgCounters.month,
              orgCounters.kind,
            ],
            set: { next: n },
          })
      }
      const ids: string[] = []
      for (const [index, r] of plan.reports.entries()) {
        const userId = userIds[r.reporter]
        if (!userId) throw new Error("reporter index out of range")
        const [row] = await tx
          .insert(reports)
          .values({
            orgId: org.id,
            userId,
            publicCode: r.code,
            submissionId: r.submissionId,
            relation: r.relation,
            otherConsent: r.otherConsent,
            provinceCode: r.provinceCode,
            regencyCode: r.regencyCode,
            districtCode: r.districtCode,
            title: r.title,
            story: r.story,
            categoryId: r.categoryId,
            subcategoryId: r.subcategoryId,
            occurredOn: r.occurredOn,
            agency: r.agency,
            urgency: r.urgency,
            affectedGroups: r.affectedGroups,
            affectedCount: r.affectedCount,
            ongoing: r.ongoing,
            // No real phone numbers
            contactable: false,
            consents: r.consents,
            consentTextVersion: r.consentTextVersion,
          })
          .returning({ id: reports.id })
        if (!row) throw new Error("report not inserted")
        ids.push(row.id)
        await tx
          .insert(members)
          .values({ organizationId: org.id, userId, role: "reporter" })
          .onConflictDoNothing({
            target: [members.organizationId, members.userId],
          })
        await tx.insert(auditLog).values({
          orgId: org.id,
          actorId: userId,
          action: "report.submit",
          entityType: "report",
          entityId: row.id,
        })
        if (r.extraFile) {
          const file = EXTRA_FILES[r.extraFile]
          await tx.insert(evidence).values({
            orgId: org.id,
            reportId: row.id,
            position: 0,
            kind: file.kind,
            declaredName: file.name,
            declaredType: file.type,
            declaredSize:
              r.extraFile === "pending"
                ? PENDING_SIZE
                : extras[r.extraFile].length,
          })
        }
        const image = images.get(index)
        if (image) {
          await tx.insert(evidence).values({
            orgId: org.id,
            reportId: row.id,
            position: 0,
            kind: "image",
            declaredName: "foto-lokasi.jpg",
            declaredType: "image/jpeg",
            declaredSize: image.length,
          })
        }
      }
      return ids
    },
    { role: "reporter" },
  )
}

/** Real review paths. */
async function applyReviews(org: Org, plan: SamplePlan, ids: string[]) {
  await withTenant(
    org.id,
    async (tx) => {
      for (const [index, r] of plan.reports.entries()) {
        const reportId = ids[index] as string
        let status: ReportStatus = "submitted"
        for (const step of r.steps) {
          if (step.action === "merge") continue
          const result = await reviewReport(
            tx,
            org.id,
            { reportId, from: status, actorId: org.actorId, ...decision(step) },
            // Sample users get no email
            { notify: false },
          )
          if (!result.ok) throw new Error(`review ${result.reason}`)
          status = result.status
        }
      }
    },
    { role: "admin" },
  )
}

function decision(step: PlannedStep): ReviewDecision {
  switch (step.action) {
    case "verify":
      return { action: step.action, method: step.method ?? "document" }
    case "reject":
    case "mark_unverifiable": {
      const { reason, reasonText } = step
      if (!reason || !reasonText) throw new Error("decision without reason")
      if (step.action === "reject" && isRejectReason(reason)) {
        return { action: step.action, reason, reasonText }
      }
      if (step.action === "mark_unverifiable" && !isRejectReason(reason)) {
        return { action: step.action, reason, reasonText }
      }
      throw new Error(`reason ${reason} does not fit ${step.action}`)
    }
    default:
      throw new Error(`no review path for ${step.action}`)
  }
}

type IssueRef = { id: string; code: string }

/** Merges, publishes, issue actions, chronological. */
async function replayIssues(
  org: Org,
  plan: SamplePlan,
  ids: string[],
): Promise<IssueRef[]> {
  type Event =
    | { at: Date; kind: "merge"; issue: number; report: number }
    | { at: Date; kind: "publish"; issue: number }
    | { at: Date; kind: "action"; issue: number; step: number }
  const events: Event[] = []
  plan.issues.forEach((issue, i) => {
    for (const report of issue.reports) {
      const at = plan.reports[report]?.mergedAt
      if (at) events.push({ at, kind: "merge", issue: i, report })
    }
    if (issue.publishedAt) {
      events.push({ at: issue.publishedAt, kind: "publish", issue: i })
    }
    issue.actions.forEach(({ at }, step) => {
      events.push({ at, kind: "action", issue: i, step })
    })
  })
  events.sort((a, b) => a.at.getTime() - b.at.getTime())
  const refs: (IssueRef | undefined)[] = []
  for (const event of events) {
    const planned = plan.issues[event.issue]
    if (!planned) throw new Error("issue index out of range")
    const ref = refs[event.issue]
    if (event.kind === "publish") {
      if (!ref) throw new Error("publish before merge")
      const result = await runPublish(
        { id: org.id, host: org.host },
        { issueId: ref.id, actorId: org.actorId },
      )
      if (!result.ok) throw new Error(`publish ${ref.code} refused`)
      continue
    }
    if (event.kind === "action") {
      if (!ref) throw new Error("action before merge")
      const step = planned.actions[event.step]
      if (!step) throw new Error("action index out of range")
      await applyPlannedAction(org, ref, step)
      continue
    }
    const merged = await runMerge(org.id, {
      reportIds: [ids[event.report] as string],
      target: ref
        ? { kind: "existing", issueId: ref.id }
        : { kind: "new", title: planned.title, summary: planned.summary },
      actorId: org.actorId,
      now: event.at,
      notify: false,
    })
    if (!merged.ok) throw new Error(`merge refused: ${merged.reason}`)
    refs[event.issue] = { id: merged.issueId, code: merged.code }
  }
  return refs.map((ref) => {
    if (!ref) throw new Error("issue never merged")
    return ref
  })
}

/** Real issue action path. */
async function applyPlannedAction(
  org: Org,
  ref: IssueRef,
  step: PlannedIssue["actions"][number],
) {
  await withTenant(
    org.id,
    async (tx) => {
      const [current] = await tx
        .select({
          advocacy: issues.advocacyStatus,
          government: issues.govStatus,
          version: issues.version,
        })
        .from(issues)
        .where(eq(issues.id, ref.id))
      if (!current) throw new Error(`issue ${ref.code} missing`)
      const base = {
        issueId: ref.id,
        seen: current,
        actorId: org.actorId,
      }
      const { action, detail } = step
      const input = ((): IssueActionInput => {
        if (action === "refer" && detail.kind === "referral") {
          const { kind: _kind, ...referral } = detail
          if (!isReferralChannel(referral.channel) || !referral.deadlineOn) {
            throw new Error("referral detail does not fit")
          }
          return {
            ...base,
            action,
            referral: {
              ...referral,
              channel: referral.channel,
              deadlineOn: referral.deadlineOn,
            },
          }
        }
        if (action === "escalate" && detail.kind === "referral") {
          const { kind: _kind, ...referral } = detail
          if (isReferralChannel(referral.channel)) {
            throw new Error("escalation detail does not fit")
          }
          return {
            ...base,
            action,
            referral: { ...referral, channel: referral.channel },
          }
        }
        if (action === "record_response" && detail.kind === "response") {
          const { kind: _kind, ...response } = detail
          return { ...base, action, response }
        }
        if (
          action !== "refer" &&
          action !== "escalate" &&
          action !== "record_response" &&
          detail.kind === "note"
        ) {
          return { ...base, action, note: detail.note }
        }
        throw new Error(`detail ${detail.kind} does not fit ${action}`)
      })()
      const result = await applyIssueAction(tx, org.id, input)
      if (!result.ok)
        throw new Error(`${action} on ${ref.code}: ${result.reason}`)
    },
    { role: "admin" },
  )
}

function values(rows: SQL[]): SQL {
  return sql.join(rows, sql`, `)
}

/** Planned followers, as followIssue does. */
async function insertFollows(
  org: Org,
  plan: SamplePlan,
  refs: IssueRef[],
  userIds: string[],
) {
  if (plan.follows.length === 0) return
  const rows = plan.follows.map((f) => {
    const issueId = refs[f.issue]?.id
    const userId = userIds[f.reporter]
    if (!issueId || !userId) throw new Error("follow target missing")
    return { orgId: org.id, issueId, userId, createdAt: f.at }
  })
  await withTenant(
    org.id,
    async (tx) => {
      // Notifications need a membership
      await tx
        .insert(members)
        .values(
          [...new Set(rows.map((row) => row.userId))].map((userId) => ({
            organizationId: org.id,
            userId,
            role: "reporter" as const,
          })),
        )
        .onConflictDoNothing({
          target: [members.organizationId, members.userId],
        })
      await tx.insert(follows).values(rows)
    },
    { role: "reporter" },
  )
}

/** Planned event times per issue. */
function issueEventTimes(plan: SamplePlan) {
  return plan.issues.flatMap((issue, index) => {
    const published = issue.publishedAt?.getTime()
    if (published === undefined) return []
    // Merges after publish add events
    const merges = issue.reports.flatMap((report) => {
      const at = plan.reports[report]?.mergedAt
      return at && at.getTime() > published ? [at] : []
    })
    const times = [...merges, ...issue.actions.map((a) => a.at)].sort(
      (a, b) => a.getTime() - b.getTime(),
    )
    return [{ issue: index, times }]
  })
}

/** Restore history after real paths. */
async function backdate(
  migrator: Db,
  org: Org,
  _target: Org | undefined,
  plan: SamplePlan,
  ids: string[],
  refs: IssueRef[],
  userIds: string[],
) {
  const lastStep = (r: PlannedReport) => r.steps.at(-1)?.at ?? r.createdAt
  await withTenant(
    org.id,
    async (tx) => {
      await tx.execute(sql`
        UPDATE reports r SET created_at = v.created, consented_at = v.created,
          updated_at = v.updated, verified_at = v.verified
        FROM (VALUES ${values(
          plan.reports.map(
            (r, i) =>
              sql`(${ids[i]}::uuid, ${iso(r.createdAt)}::timestamptz, ${iso(lastStep(r))}::timestamptz, ${r.verifiedAt ? iso(r.verifiedAt) : null}::timestamptz)`,
          ),
        )}) AS v(id, created, updated, verified)
        WHERE r.id = v.id`)
      const merged = plan.reports.flatMap((r, i) =>
        r.mergedAt
          ? [sql`(${ids[i]}::uuid, ${iso(r.mergedAt)}::timestamptz)`]
          : [],
      )
      await tx.execute(sql`
        UPDATE issue_reports l SET created_at = v.at
        FROM (VALUES ${values(merged)}) AS v(id, at)
        WHERE l.report_id = v.id`)
      // Reporters followed at merge
      await tx.execute(sql`
        UPDATE follows f SET created_at = v.at
        FROM (
          SELECT l.issue_id, r.user_id, min(l.created_at) AS at
          FROM issue_reports l
          JOIN reports r ON r.org_id = l.org_id AND r.id = l.report_id
          WHERE r.id IN (${values(ids.map((id) => sql`${id}::uuid`))})
          GROUP BY l.issue_id, r.user_id
        ) v
        WHERE f.issue_id = v.issue_id AND f.user_id = v.user_id`)
      await tx.execute(sql`
        UPDATE issues i SET created_at = v.created, published_at = v.published,
          last_activity_at = v.active, updated_at = v.active
        FROM (VALUES ${values(
          plan.issues.map(
            (issue, i) =>
              sql`(${refs[i]?.id}::uuid, ${iso(issue.createdAt)}::timestamptz, ${issue.publishedAt ? iso(issue.publishedAt) : null}::timestamptz, ${iso(issue.lastActivityAt)}::timestamptz)`,
          ),
        )}) AS v(id, created, published, active)
        WHERE i.id = v.id`)
      const decided = plan.reports.flatMap((r, i) =>
        r.steps.flatMap((step) =>
          step.action === "verify" ||
          step.action === "reject" ||
          step.action === "mark_unverifiable"
            ? [
                sql`(${ids[i]}::uuid, ${step.action}, ${iso(step.at)}::timestamptz)`,
              ]
            : [],
        ),
      )
      await tx.execute(sql`
        UPDATE moderation_decisions d SET decided_at = v.at, created_at = v.at
        FROM (VALUES ${values(decided)}) AS v(id, action, at)
        WHERE d.report_id = v.id AND d.action = v.action`)
      const timeline = issueEventTimes(plan).flatMap(({ issue, times }) =>
        times.map(
          (at, n) =>
            sql`(${refs[issue]?.id}::uuid, ${n + 1}::int, ${iso(at)}::timestamptz)`,
        ),
      )
      if (timeline.length > 0) {
        await tx.execute(sql`
          UPDATE issue_events e SET occurred_at = v.at
          FROM (
            SELECT id, issue_id,
              row_number() OVER (PARTITION BY issue_id ORDER BY id) AS n
            FROM issue_events
          ) o
          JOIN (VALUES ${values(timeline)}) AS v(issue_id, n, at)
            ON v.issue_id = o.issue_id AND v.n = o.n
          WHERE e.id = o.id`)
        await tx.execute(sql`
          UPDATE referrals r SET created_at = e.occurred_at
          FROM issue_events e WHERE e.referral_id = r.id`)
        await tx.execute(sql`
          UPDATE responses r SET created_at = e.occurred_at
          FROM issue_events e WHERE e.response_id = r.id`)
      }
      await tx.execute(sql`
        UPDATE evidence e SET created_at = r.created_at,
          received_at = r.created_at + interval '4 minutes',
          updated_at = r.created_at + interval '9 minutes'
        FROM reports r
        WHERE e.report_id = r.id AND r.id IN (${values(ids.map((id) => sql`${id}::uuid`))})`)
    },
    { db: migrator },
  )
  // Global table, no tenant
  await migrator.execute(sql`
    UPDATE members m SET created_at = v.at
    FROM (VALUES ${values(
      plan.reporters.map(
        (r, i) => sql`(${userIds[i]}::uuid, ${iso(r.createdAt)}::timestamptz)`,
      ),
    )}) AS v(id, at)
    WHERE m.user_id = v.id AND m.organization_id = ${org.id}`)
}

/** Upload step, then real job. */
async function processEvidence(
  org: Org,
  plan: SamplePlan,
  deps: { filesDir: string; media?: Db; extras: () => Promise<ExtraBytes> },
): Promise<number> {
  // Left unsent for /lacak
  const pending = new Set(
    plan.reports.flatMap((r) => (r.extraFile === "pending" ? [r.code] : [])),
  )
  const found = await withTenant(org.id, (tx) =>
    tx
      .select({
        id: evidence.id,
        kind: evidence.kind,
        status: evidence.status,
        code: reports.publicCode,
      })
      .from(evidence)
      .innerJoin(reports, eq(reports.id, evidence.reportId))
      .innerJoin(users, eq(users.id, reports.userId))
      .where(
        and(
          isSampleUser,
          inArray(evidence.status, ["awaiting_upload", "received"]),
        ),
      ),
  )
  const rows = found.filter((row) => !pending.has(row.code))
  const media = { filesDir: deps.filesDir, db: deps.media }
  const handle = createEvidenceHandler(media)
  const handleVideo = createVideoHandler(media)
  for (const row of rows) {
    if (row.status === "awaiting_upload") {
      const bytes =
        row.kind === "image"
          ? await abstractImage(row.code)
          : (await deps.extras())[row.kind]
      const path = originalPath(deps.filesDir, org.id, row.id)
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, bytes)
      await withTenant(
        org.id,
        (tx) =>
          tx
            .update(evidence)
            .set({
              status: "received",
              detectedType:
                EXTRA_FILES[row.kind === "image" ? "pending" : row.kind].type,
              byteSize: bytes.length,
              sha256: createHash("sha256").update(bytes).digest("hex"),
              receivedAt: sql`now()`,
              updatedAt: sql`now()`,
            })
            .where(
              and(
                eq(evidence.id, row.id),
                eq(evidence.status, "awaiting_upload"),
              ),
            ),
        { role: "reporter" },
      )
    }
    const job = { orgId: org.id, evidenceId: row.id }
    const outcome =
      row.kind === "video" ? await handleVideo(job) : await handle(job)
    if (outcome !== "ready") throw new Error(`evidence ${row.id}: ${outcome}`)
  }
  return rows.length
}

let jobsStarted = false

/** Real decisions need pg-boss. */
async function startJobs(): Promise<void> {
  if (jobsStarted) return
  await database().boss.start()
  jobsStarted = true
}

/** Real decide, then publish. */
async function publishSampleEvidence(
  org: Org,
  plan: SamplePlan,
  deps: { filesDir: string; media?: Db; migrator: Db },
): Promise<number> {
  const planned = new Map(
    plan.reports.flatMap((r) =>
      r.evidenceDecision ? [[r.code, r.evidenceDecision] as const] : [],
    ),
  )
  const rows = await withTenant(org.id, (tx) =>
    tx
      .select({
        id: evidence.id,
        code: reports.publicCode,
        status: evidence.status,
        decision: evidence.decision,
      })
      .from(evidence)
      .innerJoin(reports, eq(reports.id, evidence.reportId))
      .innerJoin(users, eq(users.id, reports.userId))
      .where(isSampleUser),
  )
  // Forwarded copies have no plan
  const ours = rows.filter((row) => planned.has(row.code))
  for (const row of ours) {
    const input = planned.get(row.code)
    if (!input || row.status !== "ready" || row.decision) continue
    await startJobs()
    const result = await decideEvidence(org.id, {
      evidenceId: row.id,
      actorId: org.actorId,
      seen: null,
      input,
    })
    if (!result.ok) throw new Error(`decide ${row.id}: ${result.reason}`)
  }
  const publish = createPublishHandler({
    filesDir: deps.filesDir,
    db: deps.media,
    store: localStore(() => deps.filesDir),
  })
  let published = 0
  for (const row of ours) {
    const outcome = await publish({ orgId: org.id, evidenceId: row.id })
    if (outcome === "published") published++
  }
  // Ran inline, drop queued copies
  if (ours.length > 0) {
    await deps.migrator.execute(sql`
      DELETE FROM pgboss.job WHERE name = 'evidence-publish'
        AND data->>'evidenceId' IN (${sql.join(
          ours.map((row) => sql`${row.id}`),
          sql`, `,
        )})`)
  }
  return published
}

async function seedOrg(
  org: Org,
  target: Org | undefined,
  plan: SamplePlan,
  deps: SampleDeps & { filesDir: string },
): Promise<void> {
  const userIds = await insertReporters(plan)
  const images: Images = new Map()
  for (const [index, r] of plan.reports.entries()) {
    if (r.evidence > 0) images.set(index, await abstractImage(r.code))
  }
  const extras = await extraBytes()
  const ids = await insertReports(org, plan, userIds, images, extras)
  await applyReviews(org, plan, ids)
  const refs = await replayIssues(org, plan, ids)
  await insertFollows(org, plan, refs, userIds)
  await processEvidence(org, plan, { ...deps, extras: async () => extras })
  await publishSampleEvidence(org, plan, deps)
  await backdate(deps.migrator, org, target, plan, ids, refs, userIds)
}

export type SampleSummary = Record<
  string,
  {
    state: SampleState
    reports: number
    issues: number
    demands: DemandSampleState
  }
>

/** Idempotent: complete orgs are skipped. */
export async function seedSample(deps: SampleDeps): Promise<SampleSummary> {
  const now = deps.now ?? new Date()
  const filesDir = deps.filesDir ?? defaultFilesDir()
  await seedSampleRegions(deps.migrator)
  const summary: SampleSummary = {}
  const orgs = await loadOrgs()
  for (const org of orgs) {
    // Forwards reach the other
    const target = orgs.find((other) => other.id !== org.id)
    const plan = buildSamplePlan(SAMPLE_PROFILES[org.slug], now)
    const state = await sampleState(org, plan)
    if (state === "partial") {
      throw new Error(
        `Sample data for ${org.slug} is incomplete or from an older plan. Run bun run db:seed:sample --reset, then seed again.`,
      )
    }
    if (state === "empty") {
      await seedOrg(org, target, plan, { ...deps, filesDir })
    } else {
      await processEvidence(org, plan, {
        filesDir,
        media: deps.media,
        extras: extraBytes,
      })
      await publishSampleEvidence(org, plan, { ...deps, filesDir })
    }
    // Tuntutan are admin authored
    await startJobs()
    const demands = await seedSampleDemands(org, {
      migrator: deps.migrator,
      media: deps.media,
      filesDir,
      now,
    })
    summary[org.slug] = {
      state,
      reports: plan.reports.length,
      issues: plan.issues.length,
      demands,
    }
  }
  await refreshDashboards(database().db)
  return summary
}

/** Sample rows only, audit_log stays. */
export async function resetSample(
  deps: Pick<SampleDeps, "migrator" | "filesDir">,
): Promise<{
  reports: number
  issues: number
  demands: number
  users: number
}> {
  const filesDir = deps.filesDir ?? defaultFilesDir()
  const orgs = await deps.migrator
    .select({ id: organizations.id, host: organizations.host })
    .from(organizations)
  let removedReports = 0
  let removedIssues = 0
  let removedDemands = 0
  for (const org of orgs) {
    // Before issues, links cascade
    removedDemands += await resetSampleDemands(org.id, {
      migrator: deps.migrator,
      filesDir,
    })
    const files = await withTenant(
      org.id,
      async (tx) => {
        const sample = await tx
          .select({ id: reports.id })
          .from(reports)
          .innerJoin(users, eq(users.id, reports.userId))
          .where(isSampleUser)
        const reportIds = sample.map((row) => row.id)
        if (reportIds.length === 0) return []
        const evidenceRows = await tx
          .select({ id: evidence.id, media: evidence.publicMedia })
          .from(evidence)
          .where(inArray(evidence.reportId, reportIds))
        const links = await tx
          .delete(issueReports)
          .where(inArray(issueReports.reportId, reportIds))
          .returning({ issueId: issueReports.issueId })
        const issueIds = [...new Set(links.map((link) => link.issueId))]

        // Issues with other reports stay
        const gone =
          issueIds.length === 0
            ? []
            : await tx
                .delete(issues)
                .where(
                  and(
                    inArray(issues.id, issueIds),
                    sql`NOT EXISTS (SELECT 1 FROM issue_reports l WHERE l.issue_id = ${issues.id})`,
                  ),
                )
                .returning({
                  id: issues.id,
                  year: issues.year,
                  month: issues.month,
                })
        // No FK, rows outlive issues
        if (gone.length > 0) {
          await tx.delete(takedowns).where(
            inArray(
              takedowns.issueId,
              gone.map((row) => row.id),
            ),
          )
        }
        const periods = new Map(
          gone.map((row) => [`${row.year}-${row.month}`, row]),
        )
        for (const { year, month } of periods.values()) {
          await tx.execute(sql`
            WITH top AS (
              SELECT max(number) AS n FROM issues
              WHERE org_id = ${org.id} AND year = ${year} AND month = ${month})
            UPDATE org_counters SET next = (SELECT n FROM top)
            WHERE org_id = ${org.id} AND year = ${year} AND month = ${month}
              AND kind = 'issue' AND (SELECT n FROM top) IS NOT NULL`)
          await tx.execute(sql`
            DELETE FROM org_counters
            WHERE org_id = ${org.id} AND year = ${year} AND month = ${month}
              AND kind = 'issue'
              AND NOT EXISTS (SELECT 1 FROM issues
                WHERE org_id = ${org.id} AND year = ${year} AND month = ${month})`)
        }
        await tx.delete(reports).where(inArray(reports.id, reportIds))
        // LPR counters back to remaining
        await tx.execute(sql`
          WITH top AS (
            SELECT split_part(public_code, '-', 2)::int AS year,
              split_part(public_code, '-', 3)::int AS month,
              max(split_part(public_code, '-', 4)::int) AS n
            FROM reports
            WHERE org_id = ${org.id} AND public_code LIKE 'LPR-%'
            GROUP BY 1, 2)
          UPDATE org_counters c SET next = top.n FROM top
          WHERE c.org_id = ${org.id} AND c.kind = 'report'
            AND c.year = top.year AND c.month = top.month`)
        await tx.execute(sql`
          DELETE FROM org_counters c
          WHERE c.org_id = ${org.id} AND c.kind = 'report'
            AND NOT EXISTS (SELECT 1 FROM reports r
              WHERE r.org_id = ${org.id}
                AND r.public_code LIKE 'LPR-' || c.year || '-'
                  || lpad(c.month::text, 2, '0') || '-%')`)
        removedReports += reportIds.length
        removedIssues += gone.length
        return evidenceRows
      },
      { db: deps.migrator },
    )
    for (const { id, media } of files) {
      await rm(originalPath(filesDir, org.id, id), { force: true })
      await rm(dirname(derivedPath(filesDir, org.id, id)), {
        recursive: true,
        force: true,
      })
      for (const name of publicNames(media)) {
        await rm(publicMediaPath(filesDir, org.host, name), { force: true })
      }
    }
  }
  const removedUsers = await deps.migrator
    .delete(users)
    .where(isSampleUser)
    .returning({ id: users.id })
  await refreshDashboards(database().db)
  return {
    reports: removedReports,
    issues: removedIssues,
    demands: removedDemands,
    users: removedUsers.length,
  }
}

function publicNames(media: PublicMedia[] | null): string[] {
  return (media ?? []).flatMap((one) =>
    one.type === "image" ? [one.file] : [one.file, one.poster],
  )
}

/** Dev CLI, local targets only. */
export async function main(
  argv: string[],
  env: Record<string, string | undefined> = process.env,
): Promise<void> {
  const urls = [
    env.DATABASE_URL,
    env.DATABASE_MIGRATOR_URL,
    env.DATABASE_MEDIA_URL,
  ]
  assertDevTarget({ nodeEnv: env.NODE_ENV, urls })
  const [appUrl = "", migratorUrl = "", mediaUrl = ""] = urls
  const app = initDatabase("worker", appUrl)
  const migrator = createDatabase(migratorUrl, "migrate")
  const media = createDatabase(mediaUrl, "worker-media")
  try {
    const result = argv.includes("--reset")
      ? {
          msg: "sample data removed, audit_log rows kept",
          ...(await resetSample({ migrator: migrator.db })),
        }
      : {
          msg: "sample data seeded",
          orgs: await seedSample({ migrator: migrator.db, media: media.db }),
        }
    console.log(JSON.stringify(result))
  } finally {
    // Started only for decisions
    if (jobsStarted) await app.boss.stop({ graceful: false })
    await Promise.all([app.pool.end(), migrator.pool.end(), media.pool.end()])
  }
}

if (import.meta.main) await main(process.argv.slice(2))
