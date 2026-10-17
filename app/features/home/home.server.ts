import { latestDemands } from "../demands/demands.server"
import { listShowcases } from "../issues/issues.server"

/** Showcase lists for home. */
export async function loadHome(tenant: { id: string }) {
  const [lists, demands] = await Promise.all([
    listShowcases(tenant.id),
    latestDemands(tenant.id),
  ])
  return { lists, demands }
}
