import { importantDemands, latestDemands } from "../demands/demands.server"
import { toDigest } from "../demands/digest.server"
import { listLatestIssues } from "../issues/issues.server"

// Starting Values: home tuntutan
const HOME_LATEST = 3
const HOME_IMPORTANT = 3

/** Tuntutan and issues for home. */
export async function loadHome(tenant: { id: string }) {
  const [issues, latest, important] = await Promise.all([
    listLatestIssues(tenant.id),
    latestDemands(tenant.id, HOME_LATEST),
    importantDemands(tenant.id, HOME_IMPORTANT),
  ])
  return {
    issues,
    demands: {
      latest: latest.map(toDigest),
      important: important.map(toDigest),
    },
  }
}
