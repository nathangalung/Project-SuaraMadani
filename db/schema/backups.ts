import { sql } from "drizzle-orm"
import {
  bigint,
  check,
  index,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core"

export const BACKUP_KINDS = [
  "pgbackrest",
  // pgbackrest verify, no AEAD
  "pgbackrest-verify",
  "restic",
  "b2-copy",
  // ASVS V16.4.3: off-host logs
  "logs",
] as const
export type BackupKind = (typeof BACKUP_KINDS)[number]

// Written by infra backup wrappers
export const backupRuns = pgTable(
  "backup_runs",
  {
    id: bigint("id", { mode: "number" })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    kind: text("kind").$type<BackupKind>().notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("backup_runs_kind_finished_idx").on(t.kind, t.finishedAt.desc()),
    check(
      "backup_runs_kind_check",
      sql`${t.kind} IN ('pgbackrest', 'pgbackrest-verify', 'restic', 'b2-copy', 'logs')`,
    ),
  ],
)
