import { type SQL, sql } from "drizzle-orm"
import {
  type AnyPgColumn,
  customType,
  pgPolicy,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core"

const SAFE_LITERAL = /^[a-z0-9_.]+$/

function literals(values: readonly string[]): SQL {
  for (const value of values) {
    if (!SAFE_LITERAL.test(value)) throw new Error(`Unsafe literal: ${value}`)
  }
  return sql.raw(values.map((value) => `'${value}'`).join(", ")) // sql-raw-ok: checked above
}

/** CHECK list from code constants. */
export function oneOf(column: AnyPgColumn, values: readonly string[]): SQL {
  return sql`${column} IN (${literals(values)})`
}

/** text[] literal from code constants. */
export function textArray(values: readonly string[]): SQL {
  return sql`ARRAY[${literals(values)}]::text[]`
}

export const primaryId = () => uuid("id").primaryKey().default(sql`uuidv7()`)

export const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow()

export const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()

/** Raises when unset, see 0002. */
const CURRENT_ORG = sql`(SELECT public.current_org_id())`

export function tenantPolicy() {
  return pgPolicy("tenant_isolation", {
    as: "permissive",
    for: "all",
    using: sql`org_id = ${CURRENT_ORG}`,
    withCheck: sql`org_id = ${CURRENT_ORG}`,
  })
}

export type Point = { lng: number; lat: number }

/** Parses EWKB hex points. */
export function parseEwkbPoint(hex: string): Point {
  const bytes = Uint8Array.from(hex.match(/../g) ?? [], (h) =>
    Number.parseInt(h, 16),
  )
  const view = new DataView(bytes.buffer)
  const little = view.getUint8(0) === 1
  const type = view.getUint32(1, little)
  if ((type & 0xff) !== 1) throw new Error("Not a point")
  const offset = type & 0x20000000 ? 9 : 5
  return {
    lng: view.getFloat64(offset, little),
    lat: view.getFloat64(offset + 8, little),
  }
}

// Drizzle's geometry() drops the SRID
export const point4326 = customType<{ data: Point; driverData: string }>({
  dataType: () => "geometry(Point,4326)",
  toDriver: (value) =>
    sql`ST_SetSRID(ST_MakePoint(${value.lng}, ${value.lat}), 4326)`,
  fromDriver: parseEwkbPoint,
})

// Generated search columns only
export const tsvector = customType<{ data: string }>({
  dataType: () => "tsvector",
})

// node-postgres returns a Buffer
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
})
