import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres"
import { Pool, type PoolConfig } from "pg"
import { PgBoss } from "pg-boss"
import * as audit from "./schema/audit.ts"
import * as auth from "./schema/auth.ts"
import * as backups from "./schema/backups.ts"
import * as dashboard from "./schema/dashboard.ts"
import * as demands from "./schema/demands.ts"
import * as issues from "./schema/issues.ts"
import * as moderation from "./schema/moderation.ts"
import * as notifications from "./schema/notifications.ts"
import * as organizations from "./schema/organizations.ts"
import * as regions from "./schema/regions.ts"
import * as reports from "./schema/reports.ts"
import * as whatsapp from "./schema/whatsapp.ts"

export const schema = {
  ...auth,
  ...organizations,
  ...regions,
  ...reports,
  ...issues,
  ...demands,
  ...audit,
  ...moderation,
  ...dashboard,
  ...notifications,
  ...backups,
  ...whatsapp,
}

export type Db = NodePgDatabase<typeof schema>

export type PoolProfile =
  | "web"
  | "worker"
  | "worker-media"
  | "worker-whatsapp"
  | "migrate"

type Limits = {
  max: number
  statement: number
  lock: number
  idleInTx: number
  transaction: number
}

// Starting Values, architecture.md
const LIMITS: Record<PoolProfile, Limits> = {
  web: {
    max: 10,
    statement: 5000,
    lock: 3000,
    idleInTx: 10000,
    transaction: 15000,
  },
  worker: {
    max: 12,
    statement: 60000,
    lock: 3000,
    idleInTx: 60000,
    transaction: 0,
  },
  "worker-media": {
    max: 4,
    statement: 60000,
    lock: 3000,
    idleInTx: 60000,
    transaction: 0,
  },
  // One socket, one job
  "worker-whatsapp": {
    max: 3,
    statement: 15000,
    lock: 3000,
    idleInTx: 30000,
    transaction: 0,
  },
  migrate: {
    max: 2,
    statement: 15000,
    lock: 5000,
    idleInTx: 60000,
    transaction: 0,
  },
}

export function poolConfig(
  connectionString: string,
  profile: PoolProfile,
): PoolConfig {
  const limits = LIMITS[profile]
  const settings = [
    `statement_timeout=${limits.statement}`,
    `lock_timeout=${limits.lock}`,
    `idle_in_transaction_session_timeout=${limits.idleInTx}`,
    `transaction_timeout=${limits.transaction}`,
  ]
  return {
    connectionString,
    max: limits.max,
    connectionTimeoutMillis: 2000,
    idleTimeoutMillis: 30000,
    application_name: profile,
    options: settings.map((setting) => `-c ${setting}`).join(" "),
  }
}

export type Database = { pool: Pool; db: Db; boss: PgBoss }

export function createDatabase(
  connectionString: string,
  profile: PoolProfile,
): Database {
  const pool = new Pool(poolConfig(connectionString, profile))
  // Idle errors must not crash
  pool.on("error", (error) => {
    console.error(
      JSON.stringify({ msg: "pg pool error", error: error.message }),
    )
  })
  const db = drizzle({ client: pool, schema })
  // Shares pool, migrate owns schema
  const boss = new PgBoss({
    db: { executeSql: (text, values) => pool.query(text, values) },
    supervise: false,
    schedule: false,
    migrate: false,
    createSchema: false,
  })
  // Unhandled emit prints stacks
  boss.on("error", (error) => {
    console.error(
      JSON.stringify({ msg: "pg-boss error", error: error.message }),
    )
  })
  return { pool, db, boss }
}

function appDatabaseUrl(): string {
  const name =
    process.env.NODE_ENV === "test" ? "TEST_DATABASE_URL" : "DATABASE_URL"
  const url = process.env[name]
  if (!url) throw new Error(`${name} is not set`)
  return url
}

let instance: Database | undefined

/** Call once at process start. */
export function initDatabase(
  profile: PoolProfile,
  connectionString = appDatabaseUrl(),
): Database {
  if (instance) throw new Error("Database already initialised")
  instance = createDatabase(connectionString, profile)
  return instance
}

/** Lazy web default. */
export function database(): Database {
  instance ??= createDatabase(appDatabaseUrl(), "web")
  return instance
}
