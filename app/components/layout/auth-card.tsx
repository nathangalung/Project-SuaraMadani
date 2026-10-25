import type { ReactNode } from "react"

export const AUTH_TITLE =
  "font-bold font-heading text-3xl text-ink leading-tight [font-synthesis-weight:none] sm:text-4xl"

/** Card on the page wash. */
export function AuthCard({ children }: { children: ReactNode }) {
  return (
    <div className="relative isolate flex flex-1 items-center justify-center bg-page px-4 py-16">
      <div
        aria-hidden="true"
        className="header-bg absolute inset-x-0 top-0 -z-10 h-72 [mask-image:linear-gradient(180deg,#000_0%,transparent_100%)]"
      />
      <div className="w-full max-w-2xl rounded-2xl border border-line-subtle bg-surface-raised p-7 sm:p-12">
        {children}
      </div>
    </div>
  )
}
