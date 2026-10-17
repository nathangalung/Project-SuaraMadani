import {
  demandUnfollowTarget,
  unfollowDemand,
} from "~/features/demands/follow.server"
import {
  UnfollowCard,
  type UnfollowCopy,
  type UnfollowView,
} from "~/features/issues/unfollow-card"
import { readLink } from "~/features/report/signed-link.server"
import { m } from "~/paraglide/messages.js"
import { tenantContext } from "../../context.ts"
import type { Route } from "./+types/unfollow"

// Logo-only header, task focus
export const handle = { shell: "auth" }

// Token page, no referrer
export function headers() {
  return {
    "Cache-Control": "private, no-store",
    "Referrer-Policy": "no-referrer",
  }
}

async function resolve(
  context: Route.LoaderArgs["context"],
  code: string,
  token: string,
): Promise<UnfollowView & { userId?: string }> {
  const tenant = context.get(tenantContext)
  const claim = readLink(token, "berhenti-tuntutan", tenant.id)
  if (!claim) return { state: "invalid", code }
  const target = await demandUnfollowTarget(
    tenant.id,
    claim.subjectId,
    claim.userId,
  )
  // Token names one demand only
  if (!target || target.code !== code) return { state: "invalid", code }
  return {
    state: target.following ? "confirm" : "not_following",
    code: target.code,
    title: target.title,
    token,
    userId: claim.userId,
  }
}

export async function loader({
  request,
  params,
  context,
}: Route.LoaderArgs): Promise<UnfollowView> {
  const token = new URL(request.url).searchParams.get("t") ?? ""
  const { userId: _userId, ...view } = await resolve(
    context,
    params.code,
    token,
  )
  return view
}

// GET never unfollows: link scanners
export async function action({ request, params, context }: Route.ActionArgs) {
  const token = String((await request.formData()).get("t") ?? "")
  const found = await resolve(context, params.code, token)
  if (found.state === "invalid" || !found.userId) return { done: false }
  await unfollowDemand(context.get(tenantContext).id, found.code, found.userId)
  return { done: true }
}

const COPY: UnfollowCopy = {
  title: m.demand_unfollow_title,
  lead: m.demand_unfollow_lead,
  done: m.demand_unfollow_done,
  notFollowing: m.demand_unfollow_not_following,
  invalid: m.demand_unfollow_invalid,
  view: m.demand_unfollow_view,
}

export default function DemandUnfollow({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  return (
    <UnfollowCard
      view={loaderData}
      done={actionData?.done}
      copy={COPY}
      href={`/tuntutan/${loaderData.code}`}
    />
  )
}
