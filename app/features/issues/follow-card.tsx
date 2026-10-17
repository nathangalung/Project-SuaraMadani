import { Bell, BellOff, Check } from "lucide-react"
import { useFetcher } from "react-router"
import { Button, ButtonLink } from "~/components/ui/button"
import { m } from "~/paraglide/messages.js"

// emailReady: mail can be sent
export type FollowState = { following: boolean; emailReady: boolean } | null

type FollowKind = "issue" | "demand"

const BASE: Record<FollowKind, string> = {
  issue: "/isu",
  demand: "/tuntutan",
}

export function signInToFollow(code: string, kind: FollowKind = "issue") {
  return `/masuk?kembali=${encodeURIComponent(`${BASE[kind]}/${code}`)}`
}

const COPY = {
  issue: {
    title: m.issue_follow_title,
    body: m.issue_follow_body,
    following: m.issue_following,
    action: m.issue_follow_action,
  },
  demand: {
    title: m.demand_follow_title,
    body: m.demand_follow_body,
    following: m.demand_following,
    action: m.demand_follow_action,
  },
} as const

// Form POST, works without JS
export function FollowCard({
  code,
  state,
  kind = "issue",
}: {
  code: string
  // Null: signed out, page cacheable
  state: FollowState
  kind?: FollowKind
}) {
  const copy = COPY[kind]
  const fetcher = useFetcher()
  const intent = fetcher.formData?.get("intent")
  // Optimistic while saving
  const following =
    typeof intent === "string" ? intent === "follow" : Boolean(state?.following)
  return (
    <section
      id="ikuti"
      aria-labelledby="follow-title"
      className="border-ink border-t-2 pt-5"
    >
      <h2 id="follow-title" className="font-bold text-lg">
        {copy.title()}
      </h2>
      <p
        role="status"
        className="mt-1 flex items-start gap-1.5 text-ink-soft text-sm"
      >
        {following && state?.emailReady !== false ? (
          <Check
            aria-hidden="true"
            className="confirm-in mt-0.5 size-4 shrink-0 text-success"
          />
        ) : null}
        {state?.emailReady === false
          ? m.follow_email_unverified()
          : following
            ? copy.following()
            : copy.body()}
      </p>
      {state === null ? (
        <>
          <ButtonLink
            to={signInToFollow(code, kind)}
            variant="secondary"
            className="mt-4 w-full"
          >
            <Bell aria-hidden="true" className="size-4" />
            {copy.action()}
          </ButtonLink>
          <p className="mt-2 text-ink-muted text-xs">
            {m.issue_follow_sign_in()}
          </p>
        </>
      ) : (
        <fetcher.Form method="post" className="mt-4">
          <input
            type="hidden"
            name="intent"
            value={following ? "unfollow" : "follow"}
          />
          <Button
            type="submit"
            variant={following ? "quiet" : "secondary"}
            className="w-full"
            pending={fetcher.state !== "idle"}
          >
            {following ? (
              <BellOff aria-hidden="true" className="size-4" />
            ) : (
              <Bell aria-hidden="true" className="size-4" />
            )}
            {following ? m.issue_unfollow_action() : copy.action()}
          </Button>
        </fetcher.Form>
      )}
    </section>
  )
}
