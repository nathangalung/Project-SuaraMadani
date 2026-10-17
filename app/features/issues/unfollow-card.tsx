import { BellOff, CircleCheck } from "lucide-react"
import { Form, useNavigation } from "react-router"
import { AUTH_TITLE, AuthCard } from "~/components/layout/auth-card"
import { Button, ButtonLink } from "~/components/ui/button"
import { Note } from "~/components/ui/note"
import { useSiteTitle } from "~/features/report/page-title"
import { m } from "~/paraglide/messages.js"

type CodeText = (p: { code: string }) => string

export type UnfollowCopy = {
  title: () => string
  lead: CodeText
  done: CodeText
  notFollowing: CodeText
  invalid: () => string
  view: () => string
}

export type UnfollowView =
  | { state: "invalid"; code: string }
  | {
      state: "confirm" | "not_following"
      code: string
      title: string
      token: string
    }

/** Issue and tuntutan unsubscribe pages. */
export function UnfollowCard({
  view,
  done,
  copy,
  href,
}: {
  view: UnfollowView
  // Undefined: not posted yet
  done: boolean | undefined
  copy: UnfollowCopy
  href: string
}) {
  const title = useSiteTitle(copy.title())
  const navigation = useNavigation()
  const { code } = view
  const invalid = view.state === "invalid" || done === false
  return (
    <AuthCard>
      <title>{title}</title>
      <span
        aria-hidden="true"
        className="grid size-12 place-items-center bg-brand"
      >
        {done ? (
          <CircleCheck className="confirm-in size-6 text-on-accent" />
        ) : (
          <BellOff className="size-6 text-on-accent" />
        )}
      </span>
      <h1 className={`mt-4 ${AUTH_TITLE}`}>{copy.title()}</h1>
      {"title" in view ? (
        <p className="mt-3 font-semibold text-ink">{view.title}</p>
      ) : null}
      {done ? (
        <Note tone="success" className="mt-5">
          <p role="status">{copy.done({ code })}</p>
        </Note>
      ) : invalid ? (
        <Note tone="info" className="mt-5">
          {copy.invalid()}
        </Note>
      ) : view.state === "not_following" ? (
        <p className="mt-3 text-ink-muted leading-relaxed">
          {copy.notFollowing({ code })}
        </p>
      ) : (
        <Form method="post" className="mt-3">
          <p className="text-ink-muted leading-relaxed">
            {copy.lead({ code })}
          </p>
          <input type="hidden" name="t" value={view.token} />
          <Button
            type="submit"
            variant="dark"
            className="mt-6 w-full"
            pending={navigation.state !== "idle"}
          >
            {m.unfollow_confirm()}
          </Button>
        </Form>
      )}
      <ButtonLink to={href} variant="quiet" className="mt-4 w-full">
        {copy.view()}
      </ButtonLink>
    </AuthCard>
  )
}
