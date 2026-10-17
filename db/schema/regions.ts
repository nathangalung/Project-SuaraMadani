import { sql } from "drizzle-orm"
import {
  type AnyPgColumn,
  check,
  index,
  pgTable,
  smallint,
  text,
} from "drizzle-orm/pg-core"

// Global, outside RLS, levels 1-4
export const regions = pgTable(
  "regions",
  {
    code: text("code").primaryKey(),
    parentCode: text("parent_code").references((): AnyPgColumn => regions.code),
    level: smallint("level").notNull(),
    name: text("name").notNull(),
  },
  (t) => [
    index("regions_parent_code_idx").on(t.parentCode),
    check("regions_level_check", sql`${t.level} BETWEEN 1 AND 4`),
    check(
      "regions_parent_check",
      sql`(${t.level} = 1) = (${t.parentCode} IS NULL)`,
    ),
  ],
)
