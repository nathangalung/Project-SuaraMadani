import { LoaderCircle } from "lucide-react"
import type { ButtonHTMLAttributes, MouseEvent } from "react"
import { Link, type LinkProps } from "react-router"
import { m } from "~/paraglide/messages.js"
import { cn } from "./cn"

type Variant =
  | "primary"
  | "highlight"
  | "secondary"
  | "quiet"
  | "dark"
  | "danger"
type Size = "sm" | "md" | "lg"

const base =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[10px] text-center no-underline transition-[translate,background-color,color,box-shadow] active:translate-y-0.5 disabled:pointer-events-none disabled:opacity-50 aria-disabled:cursor-progress aria-disabled:active:translate-y-0"

const variants: Record<Variant, string> = {
  primary: "bg-brand font-heading text-on-accent hover:bg-brand-hover",
  highlight:
    "border-2 border-ink bg-highlight font-semibold text-ink hover:bg-ink hover:text-highlight",
  secondary:
    "border-2 border-ink bg-surface-raised font-semibold text-ink hover:bg-ink hover:text-surface-raised",
  quiet: "font-semibold text-ink hover:bg-ink/5",
  dark: "border-2 border-ink bg-ink font-semibold text-surface-raised hover:bg-ink-hover",
  danger: "bg-danger font-semibold text-on-accent hover:bg-ink",
}

const sizes: Record<Size, string> = {
  sm: "h-9 px-4 text-sm",
  md: "min-h-11 px-5 text-base",
  lg: "h-13 px-7 text-lg",
}

export function buttonClass(
  variant: Variant = "primary",
  size: Size = "md",
  className?: string,
): string {
  return cn(base, variants[variant], sizes[size], className)
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant
  size?: Size
  // Busy but still focusable
  pending?: boolean
  pendingLabel?: string
}

export function Button({
  variant,
  size,
  pending = false,
  pendingLabel,
  className,
  type = "button",
  onClick,
  children,
  ...rest
}: ButtonProps) {
  // Blocks clicks and implicit submit
  const guard = (event: MouseEvent<HTMLButtonElement>) => {
    if (pending) return event.preventDefault()
    onClick?.(event)
  }
  return (
    <button
      type={type}
      className={buttonClass(variant, size, className)}
      aria-disabled={pending || undefined}
      onClick={guard}
      {...rest}
    >
      {pending && (
        <LoaderCircle aria-hidden="true" className="pending-spinner size-5" />
      )}
      {pending ? (pendingLabel ?? m.button_pending()) : children}
    </button>
  )
}

type ButtonLinkProps = Omit<LinkProps, "className"> & {
  variant?: Variant
  size?: Size
  className?: string
}

export function ButtonLink({
  variant,
  size,
  className,
  ...rest
}: ButtonLinkProps) {
  return <Link className={buttonClass(variant, size, className)} {...rest} />
}
