import { unfollowIssue, unfollowTarget } from "~/features/issues/follow.server"
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

type Resolved =
  | { state: "invalid" }
  | {
      state: "confirm" | "not_following"
      code: string
      title: string
      userId: string
    }

async function resolve(
  context: Route.LoaderArgs["context"],
  code: string,
  token: string,
): Promise<Resolved> {
  const tenant = context.get(tenantContext)
  const claim = readLink(token, "berhenti", tenant.id)
  if (!claim) return { state: "invalid" }
  const target = await unfollowTarget(tenant.id, claim.subjectId, claim.userId)
  // Token names one issue only
  if (!target || target.code !== code) return { state: "invalid" }
  return {
    state: target.following ? "confirm" : "not_following",
    code: target.code,
    title: target.title,
    userId: claim.userId,
  }
}

export async function loader({
  request,
  params,
  context,
}: Route.LoaderArgs): Promise<UnfollowView> {
  const token = new URL(request.url).searchParams.get("t") ?? ""
  const found = await resolve(context, params.code, token)
  if (found.state === "invalid")
    return { state: found.state, code: params.code }
  return { state: found.state, code: found.code, title: found.title, token }
}

// GET never unfollows: link scanners
export async function action({ request, params, context }: Route.ActionArgs) {
  const token = String((await request.formData()).get("t") ?? "")
  const found = await resolve(context, params.code, token)
  if (found.state === "invalid") return { done: false }
  await unfollowIssue(context.get(tenantContext).id, found.code, found.userId)
  return { done: true }
}

const COPY: UnfollowCopy = {
  title: m.unfollow_title,
  lead: m.unfollow_lead,
  done: m.unfollow_done,
  notFollowing: m.unfollow_not_following,
  invalid: m.unfollow_invalid,
  view: m.unfollow_view_issue,
}

export default function Unfollow({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  return (
    <UnfollowCard
      view={loaderData}
      done={actionData?.done}
      copy={COPY}
      href={`/isu/${loaderData.code}`}
    />
  )
}
