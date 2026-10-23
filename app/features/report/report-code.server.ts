import { nextCounter, type Tx } from "../../../db/tenant.server.ts"
import { jakartaMonth, jakartaYear } from "../../../shared/format.ts"
import { formatReportCode } from "../../../shared/report-id.ts"

/** LPR-2026-10-0001, monthly. */
export async function nextReportCode(
  tx: Tx,
  orgId: string,
  now: Date,
): Promise<string> {
  const year = jakartaYear(now)
  const month = jakartaMonth(now)
  const number = await nextCounter(tx, orgId, { year, month }, "report")
  return formatReportCode(year, month, number)
}
