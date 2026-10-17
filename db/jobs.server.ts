import { sql } from "drizzle-orm"
import { fromDrizzle, type Queue } from "pg-boss"
import type { NotificationTemplate } from "../shared/notifications.ts"
import { database } from "./client.server.ts"
import type { Tx } from "./tenant.server.ts"

// Payloads carry IDs only
type EvidenceJob = { orgId: string; evidenceId: string; reqId?: string }

export type JobPayloads = {
  evidence: EvidenceJob
  "evidence-video": EvidenceJob
  "evidence-publish": EvidenceJob
  // Cron tick, every org
  "aggregate-refresh": { reqId?: string }
  "email-send": {
    orgId: string
    notificationId: string
    // 429 re-sends, capped
    deferrals?: number
    reqId?: string
  }
  // Staff policy brief, clamd only
  "evidence-brief": { orgId: string; briefId: string; reqId?: string }
  "demand-notify": {
    orgId: string
    demandId: string
    eventId: string
    template: NotificationTemplate
    reqId?: string
  }
  "issue-notify": {
    orgId: string
    issueId: string
    eventId: string
    template: NotificationTemplate
    reqId?: string
  }
  takedown: { orgId: string; takedownId: string; reqId?: string }
  // Cron tick, retention, /privasi
  "maintenance-daily": { reqId?: string }
  // Sealed: number and code
  "whatsapp-send": { logId: string; sealed: string; reqId?: string }
}
export type QueueName = keyof JobPayloads

// Question 3, /privasi: 30 days
const DEAD_LETTER = {
  policy: "standard",
  retentionSeconds: 30 * 86_400,
} as const

// Policy fixed, rest synced
export const QUEUES: Queue[] = [
  { name: "evidence-dlq", ...DEAD_LETTER },
  // Outlasts clamd warm-up, 300 s
  {
    name: "evidence",
    policy: "standard",
    retryLimit: 5,
    retryDelay: 30,
    retryBackoff: true,
    retryDelayMax: 300,
    expireInSeconds: 300,
    heartbeatSeconds: 60,
    warningQueueSize: 200,
    deadLetter: "evidence-dlq",
  },
  { name: "evidence-video-dlq", ...DEAD_LETTER },
  // Starting Values: ffmpeg 600 s
  {
    name: "evidence-video",
    policy: "standard",
    retryLimit: 2,
    retryDelay: 120,
    retryBackoff: true,
    retryDelayMax: 300,
    expireInSeconds: 900,
    heartbeatSeconds: 60,
    warningQueueSize: 50,
    deadLetter: "evidence-video-dlq",
  },
  { name: "evidence-publish-dlq", ...DEAD_LETTER },
  {
    name: "evidence-publish",
    policy: "standard",
    retryLimit: 3,
    retryBackoff: true,
    expireInSeconds: 300,
    heartbeatSeconds: 60,
    warningQueueSize: 200,
    deadLetter: "evidence-publish-dlq",
  },
  { name: "evidence-brief-dlq", ...DEAD_LETTER },
  // Scan only, clamd warm-up
  {
    name: "evidence-brief",
    policy: "standard",
    retryLimit: 5,
    retryDelay: 30,
    retryBackoff: true,
    retryDelayMax: 300,
    expireInSeconds: 120,
    warningQueueSize: 50,
    deadLetter: "evidence-brief-dlq",
  },
  { name: "email-send-dlq", ...DEAD_LETTER },
  // Starting Values: about 9 h
  {
    name: "email-send",
    policy: "standard",
    retryLimit: 14,
    retryDelay: 60,
    retryBackoff: true,
    retryDelayMax: 3600,
    expireInSeconds: 60,
    warningQueueSize: 500,
    deadLetter: "email-send-dlq",
  },
  { name: "issue-notify-dlq", ...DEAD_LETTER },
  {
    name: "issue-notify",
    policy: "standard",
    retryLimit: 5,
    retryBackoff: true,
    expireInSeconds: 120,
    deadLetter: "issue-notify-dlq",
  },
  { name: "demand-notify-dlq", ...DEAD_LETTER },
  {
    name: "demand-notify",
    policy: "standard",
    retryLimit: 5,
    retryBackoff: true,
    expireInSeconds: 120,
    deadLetter: "demand-notify-dlq",
  },
  { name: "takedown-dlq", ...DEAD_LETTER },
  // Starting Values: takedown
  {
    name: "takedown",
    policy: "standard",
    retryLimit: 10,
    retryDelay: 15,
    retryBackoff: true,
    retryDelayMax: 300,
    expireInSeconds: 60,
    deadLetter: "takedown-dlq",
  },
  { name: "whatsapp-send-dlq", ...DEAD_LETTER },
  // Codes expire in 5 min
  {
    name: "whatsapp-send",
    policy: "standard",
    retryLimit: 2,
    retryDelay: 10,
    retryBackoff: true,
    retryDelayMax: 60,
    expireInSeconds: 60,
    warningQueueSize: 100,
    deadLetter: "whatsapp-send-dlq",
  },
  // Next tick is the retry
  {
    name: "aggregate-refresh",
    policy: "exclusive",
    retryLimit: 0,
    expireInSeconds: 600,
  },
  // Health flags a missed day
  {
    name: "maintenance-daily",
    policy: "exclusive",
    retryLimit: 2,
    retryBackoff: true,
    expireInSeconds: 1800,
  },
]

/** Commits with tx. */
export async function sendJob<Q extends QueueName>(
  tx: Tx,
  queue: Q,
  data: JobPayloads[Q],
  options: { startAfter?: Date } = {},
): Promise<string | null> {
  return database().boss.send(queue, data, {
    ...options,
    db: fromDrizzle(tx, sql),
  })
}

/** One insert, commits with tx. */
export async function sendJobs<Q extends QueueName>(
  tx: Tx,
  queue: Q,
  data: JobPayloads[Q][],
): Promise<void> {
  if (data.length === 0) return
  await database().boss.insert(
    queue,
    data.map((item) => ({ data: item })),
    { db: fromDrizzle(tx, sql) },
  )
}
