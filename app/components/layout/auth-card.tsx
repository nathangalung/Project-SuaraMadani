import type { ReactNode } from "react"

export const AUTH_TITLE =
  "font-bold font-heading text-3xl text-ink leading-tight [font-synthesis-weight:none] sm:text-4xl"

/** Mockup AuthLayout card, brand border. */
export function AuthCard({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center bg-page px-4 py-16">
      <div className="w-full max-w-md border border-brand border-t-[6px] bg-surface-raised p-7 sm:p-9">
        {children}
      </div>
    </div>
  )
}
