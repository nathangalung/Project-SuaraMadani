import type { CSSProperties, ReactNode } from "react"
import { cn } from "~/components/ui/cn"

// Band cards keep blue ring
const CARD_TONE = {
  band: "focus-light bg-surface-raised text-ink",
  brand: "bg-brand text-on-accent",
  ink: "bg-ink text-on-accent",
} as const

/** Centred H3, like DemandRow. */
export function SubTitle({
  id,
  className,
  children,
}: {
  id?: string
  className?: string
  children: string
}) {
  return (
    <h3
      id={id}
      className={cn(
        "text-center font-bold font-ui text-2xl text-on-accent",
        className,
      )}
    >
      {children}
    </h3>
  )
}

/** Home card, plain text. */
export function InfoCard({
  title,
  titleAs: Title = "h4",
  tone,
  index = 0,
  className,
  children,
}: {
  title: string
  // Follows the page outline
  titleAs?: "h3" | "h4"
  tone: keyof typeof CARD_TONE
  // Stagger order
  index?: number
  className?: string
  children: ReactNode
}) {
  return (
    <li
      style={{ "--i": index } as CSSProperties}
      className={cn(
        "flex flex-col rounded-lg p-5 font-ui lg:p-6",
        CARD_TONE[tone],
        className,
      )}
    >
      <Title className="font-bold text-lg leading-snug">{title}</Title>
      <div className="mt-2 leading-relaxed">{children}</div>
    </li>
  )
}
