import { staffLinks } from "../../../server/shell.server.ts"

/** Staff skip the citizen page. */
export async function isStaffAccount(
  orgId: string,
  userId: string,
): Promise<boolean> {
  const links = await staffLinks(orgId, userId)
  return links.manage || links.platform
}
