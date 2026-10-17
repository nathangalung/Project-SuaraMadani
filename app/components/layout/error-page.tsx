import { type ReactNode, useEffect } from "react"
import { m } from "~/paraglide/messages.js"
import { ButtonLink } from "../ui/button"
import { focusPageHeading } from "./route-focus"

/** Mockup NotFoundPage, lazy chunk. */
export function ErrorPage({
  code,
  title,
  documentTitle,
  body,
  actions,
}: {
  code?: number
  title: string
  // With the site suffix
  documentTitle: string
  body: string
  actions: ReactNode
}) {
  // Route focus ran before chunk
  useEffect(() => {
    if (document.activeElement?.matches("main")) focusPageHeading(document)
  }, [])
  return (
    <div className="bg-page px-4 py-20 text-center sm:py-28">
      <title>{documentTitle}</title>
      {code ? (
        <p
          aria-hidden="true"
          className="font-bold font-heading text-8xl text-brand leading-none [font-synthesis-weight:none]"
        >
          {code}
        </p>
      ) : null}
      <h1 className="mx-auto mt-6 max-w-2xl font-bold font-heading text-[clamp(2rem,4.4vw,3rem)] text-ink leading-[1.1] [font-synthesis-weight:none]">
        {title}
      </h1>
      <p className="mx-auto mt-3 max-w-xl text-ink-soft text-lg leading-relaxed">
        {body}
      </p>
      <div className="mt-10 flex flex-wrap justify-center gap-4">{actions}</div>
    </div>
  )
}

type ErrorText = {
  title: string
  body: string
  next?: { to: string; label: string }
}

/** Signed-in 403 never offers Masuk. */
export function errorText(
  status: number,
  signedIn: boolean,
  staff: boolean,
  national = false,
): ErrorText {
  if (status === 404) {
    return {
      title: m.error_not_found_title(),
      body: m.error_not_found_body(),
      // Apex has no issue list
      next: national
        ? { to: "/#kampus", label: m.national_choose_campus() }
        : { to: "/isu", label: m.nav_issues() },
    }
  }
  if (status !== 403) {
    return { title: m.error_generic_title(), body: m.error_generic_body() }
  }
  const title = m.error_forbidden_title()
  if (!signedIn) {
    return {
      title,
      body: m.error_forbidden_body(),
      next: { to: "/masuk", label: m.signin_page_title() },
    }
  }
  return staff
    ? {
        title,
        body: m.error_forbidden_staff_body(),
        next: { to: "/masuk/dua-langkah", label: m.error_two_factor_link() },
      }
    : { title, body: m.error_forbidden_member_body() }
}

/** Root boundary body. */
export function RootError({
  status,
  signedIn,
  staff,
  national,
  titleOf,
}: {
  status: number
  signedIn: boolean
  staff: boolean
  national: boolean
  // Adds the site suffix
  titleOf: (title: string) => string
}) {
  const page = errorText(status, signedIn, staff, national)
  return (
    <ErrorPage
      code={status === 404 || status === 403 ? status : undefined}
      title={page.title}
      documentTitle={titleOf(page.title)}
      body={page.body}
      actions={
        <>
          <ButtonLink to="/">{m.error_go_home()}</ButtonLink>
          {page.next && (
            <ButtonLink to={page.next.to} variant="secondary">
              {page.next.label}
            </ButtonLink>
          )}
        </>
      }
    />
  )
}
