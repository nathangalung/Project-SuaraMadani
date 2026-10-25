import { eq } from "drizzle-orm"
import { demandIssues } from "../../../db/schema/demands.ts"
import { issues } from "../../../db/schema/issues.ts"
import type { Tx } from "../../../db/tenant.server.ts"
import { type PurgeDeps, purgeQuietly } from "../../../server/purge.server.ts"
import { briefUrl } from "./demand-href.ts"

export type PurgedDemand = {
  code: string
  version: number
  // PDFs gone or hidden
  briefs?: readonly string[]
  // Cited issues show its block
  issues?: readonly string[]
}

/** Issue codes a demand cites. */
export async function citedIssues(tx: Tx, demandId: string): Promise<string[]> {
  const rows = await tx
    .select({ code: issues.publicCode })
    .from(demandIssues)
    .innerJoin(issues, eq(issues.id, demandIssues.issueId))
    .where(eq(demandIssues.demandId, demandId))
  return rows.map((row) => row.code)
}

/** Single-file purge targets, ADR-02. */
export function demandPurgeUrls(host: string, demand: PurgedDemand): string[] {
  const origin = `https://${host}`
  const { code } = demand
  // Every version is cached
  const images = Array.from(
    { length: demand.version },
    (_, index) => `${origin}/tuntutan/${code}/og.png?v=${index + 1}`,
  )
  return [
    `${origin}/tuntutan/${code}`,
    `${origin}/tuntutan/${code}.data`,
    `${origin}/tuntutan`,
    `${origin}/tuntutan.data`,
    `${origin}/`,
    `${origin}/_root.data`,
    `${origin}/data`,
    `${origin}/data.data`,
    ...images,
    ...(demand.briefs ?? []).map((id) => `${origin}${briefUrl(code, id)}`),
    ...(demand.issues ?? []).flatMap((issue) => [
      `${origin}/isu/${issue}`,
      `${origin}/isu/${issue}.data`,
      `${origin}/api/v1/isu/${issue}`,
    ]),
    // Public data API copies
    `${origin}/api/v1/tuntutan/${code}`,
    `${origin}/api/v1/tuntutan`,
    `${origin}/api/v1/data`,
    `${origin}/api/v1/data/tuntutan.csv`,
    `${origin}/api/v1/data/tuntutan-wilayah.csv`,
  ]
}

/** After commit, never throws. */
export function purgeDemandPages(
  host: string,
  demand: PurgedDemand,
  deps: PurgeDeps = {},
): Promise<void> {
  return purgeQuietly(
    demandPurgeUrls(host, demand),
    { host, demand: demand.code },
    deps,
  )
}
