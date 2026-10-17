import { Pool } from "pg"

export type RegionRow = readonly [string, string | null, string]

// Kepmendagri list, provenance in docs
const REGION_FILE = new URL("./wilayah.tsv", import.meta.url)
const CODE = /^\d{2}(\.\d{2}(\.\d{2}(\.\d{4})?)?)?$/
const BATCH = 5_000

/** Tab separated, parents first. */
export function parseRegions(text: string): RegionRow[] {
  const seen = new Set<string>()
  return text
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => {
      const [code = "", name = "", extra] = line.split("\t")
      if (!CODE.test(code) || name.trim() === "" || extra !== undefined) {
        throw new Error(`Malformed region line: ${line}`)
      }
      const cut = code.lastIndexOf(".")
      const parent = cut === -1 ? null : code.slice(0, cut)
      if (parent && !seen.has(parent)) {
        throw new Error(`Region ${code} before its parent`)
      }
      seen.add(code)
      return [code, parent, name] as const
    })
}

/** Full Kepmendagri code list. */
export async function readRegions(): Promise<RegionRow[]> {
  return parseRegions(await Bun.file(REGION_FILE).text())
}

// Small official subset for tests
export const TEST_REGIONS: ReadonlyArray<RegionRow> = [
  ["32", null, "Jawa Barat"],
  ["32.73", "32", "Kota Bandung"],
  ["32.73.01", "32.73", "Sukasari"],
  ["32.73.01.1001", "32.73.01", "Sukarasa"],
  ["32.73.01.1002", "32.73.01", "Gegerkalong"],
  ["32.73.01.1003", "32.73.01", "Isola"],
  ["32.73.01.1004", "32.73.01", "Sarijadi"],
  ["32.73.02", "32.73", "Coblong"],
  ["32.73.02.1001", "32.73.02", "Cipaganti"],
  ["32.73.02.1002", "32.73.02", "Lebak Gede"],
  ["32.73.02.1003", "32.73.02", "Sadang Serang"],
  ["32.73.02.1004", "32.73.02", "Dago"],
  ["32.73.02.1005", "32.73.02", "Sekeloa"],
  ["32.73.02.1006", "32.73.02", "Lebak Siliwangi"],
  ["34", null, "Daerah Istimewa Yogyakarta"],
  ["34.04", "34", "Kabupaten Sleman"],
  ["34.04.06", "34.04", "Mlati"],
  ["34.04.06.2001", "34.04.06", "Sinduadi"],
  ["34.04.06.2002", "34.04.06", "Sendangadi"],
  ["34.04.06.2003", "34.04.06", "Tlogoadi"],
  ["34.04.06.2004", "34.04.06", "Tirtoadi"],
  ["34.04.06.2005", "34.04.06", "Sumberadi"],
  ["34.04.07", "34.04", "Depok"],
  ["34.04.07.2001", "34.04.07", "Caturtunggal"],
  ["34.04.07.2002", "34.04.07", "Maguwoharjo"],
  ["34.04.07.2003", "34.04.07", "Condongcatur"],
  ["34.71", "34", "Kota Yogyakarta"],
  ["34.71.03", "34.71", "Gondokusuman"],
  ["34.71.03.1001", "34.71.03", "Demangan"],
  ["34.71.03.1002", "34.71.03", "Kotabaru"],
  ["34.71.03.1003", "34.71.03", "Klitren"],
  ["34.71.03.1004", "34.71.03", "Baciro"],
  ["34.71.03.1005", "34.71.03", "Terban"],
]

/** Parents first, batched upsert. */
export async function seedRegions(
  pool: Pool,
  rows?: ReadonlyArray<RegionRow>,
): Promise<number> {
  const list = rows ?? (await readRegions())
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    for (let at = 0; at < list.length; at += BATCH) {
      const batch = list.slice(at, at + BATCH)
      await client.query(
        `INSERT INTO regions (code, parent_code, level, name)
         SELECT * FROM unnest($1::text[], $2::text[], $3::smallint[], $4::text[])
         ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
         WHERE regions.name IS DISTINCT FROM EXCLUDED.name`,
        [
          batch.map(([code]) => code),
          batch.map(([, parent]) => parent),
          batch.map(([code]) => code.split(".").length),
          batch.map(([, , name]) => name),
        ],
      )
    }
    await client.query("COMMIT")
    return list.length
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  } finally {
    client.release()
  }
}

if (import.meta.main) {
  const pool = new Pool({ connectionString: process.env.DATABASE_MIGRATOR_URL })
  const count = await seedRegions(pool)
  await pool.end()
  console.log(JSON.stringify({ msg: "seeded regions", count }))
}
