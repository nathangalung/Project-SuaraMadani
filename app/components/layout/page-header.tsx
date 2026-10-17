import type { ReactNode } from "react"

type PageHeaderProps = {
  title: string
  description?: ReactNode
  // Band: brand strip, on-accent text
  variant?: "plain" | "band"
  // p when child owns h1
  titleAs?: "h1" | "p"
  children?: ReactNode
}

const titleClass =
  "font-bold font-heading text-[clamp(2rem,5.6vw,3.8rem)] leading-none [font-synthesis-weight:none]"

export function PageHeader({
  title,
  description,
  variant = "plain",
  titleAs: Title = "h1",
  children,
}: PageHeaderProps) {
  if (variant === "band") {
    return (
      <div className="bg-brand px-4 py-6 text-center text-on-accent sm:py-8">
        <Title className={titleClass}>{title}</Title>
        {description && (
          <p className="mx-auto mt-4 max-w-3xl text-lg leading-relaxed">
            {description}
          </p>
        )}
        {children}
      </div>
    )
  }
  return (
    <div className="relative isolate">
      <div
        aria-hidden="true"
        className="header-bg absolute inset-0 -z-10 [mask-image:linear-gradient(180deg,#000_0%,#000_30%,transparent_100%)]"
      />
      <div className="mx-auto max-w-3xl px-4 pt-10 pb-4 text-center text-ink sm:px-6 sm:pt-16">
        <Title className={`mt-2 ${titleClass}`}>{title}</Title>
        {description && (
          <p className="mt-5 text-lg leading-relaxed">{description}</p>
        )}
        {children}
      </div>
    </div>
  )
}
