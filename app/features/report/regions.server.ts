import { asc, eq, isNull } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import { type Db, database } from "../../../db/client.server.ts"
import { regions } from "../../../db/schema/regions.ts"

export type RegionOption = { code: string; name: string }

// "id" lists provinces
const ROOT = "id"
const PARENT_FILE = /^(id|\d{2}(?:\.\d{2}){0,2})\.json$/

/** Parent code from "<code>.json". */
export function parseRegionFile(file: string): string | null {
  return PARENT_FILE.exec(file)?.[1] ?? null
}

/** Null for unknown parent. */
export async function childrenOf(
  parent: string,
  db: Db = database().db,
): Promise<RegionOption[] | null> {
  if (parent !== ROOT) {
    const [found] = await db
      .select({ code: regions.code })
      .from(regions)
      .where(eq(regions.code, parent))
      .limit(1)
    if (!found) return null
  }
  return db
    .select({ code: regions.code, name: regions.name })
    .from(regions)
    .where(
      parent === ROOT
        ? isNull(regions.parentCode)
        : eq(regions.parentCode, parent),
    )
    .orderBy(asc(regions.name))
}

export type RegencyGroup = RegionOption & { regencies: RegionOption[] }

/** Kab/kota per province, staff forms. */
export async function regencyGroups(
  db: Db = database().db,
): Promise<RegencyGroup[]> {
  const province = alias(regions, "province")
  const rows = await db
    .select({
      provinceCode: province.code,
      provinceName: province.name,
      code: regions.code,
      name: regions.name,
    })
    .from(regions)
    .innerJoin(province, eq(province.code, regions.parentCode))
    .where(eq(regions.level, 2))
    .orderBy(asc(province.name), asc(regions.name))
  const groups = new Map<string, RegencyGroup>()
  for (const row of rows) {
    const group = groups.get(row.provinceCode) ?? {
      code: row.provinceCode,
      name: row.provinceName,
      regencies: [],
    }
    group.regencies.push({ code: row.code, name: row.name })
    groups.set(row.provinceCode, group)
  }
  return [...groups.values()]
}

/** /isu select: provinces, children. */
export async function regionChoices(
  wilayah: string | undefined,
  db: Db = database().db,
): Promise<{ provinces: RegionOption[]; regencies: RegionOption[] }> {
  const province = wilayah?.slice(0, 2)
  const [provinces, regencies] = await Promise.all([
    childrenOf(ROOT, db),
    province ? childrenOf(province, db) : null,
  ])
  return { provinces: provinces ?? [], regencies: regencies ?? [] }
}
