import type { ComponentProps } from "react"
import { Link, useNavigate } from "react-router"

/** No JS: reload at section. */
export function SectionLink({
  to,
  section,
  onClick,
  ...rest
}: Omit<ComponentProps<typeof Link>, "to" | "preventScrollReset"> & {
  to: string
  section: string
}) {
  const navigate = useNavigate()
  return (
    <Link
      {...rest}
      to={`${to}#${section}`}
      preventScrollReset
      onClick={(event) => {
        onClick?.(event)
        // Modified clicks open tabs
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        ) {
          return
        }
        // JS keeps the scroll position
        event.preventDefault()
        void navigate(to, { preventScrollReset: true })
      }}
    />
  )
}
