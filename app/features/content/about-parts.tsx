import type { ReactNode } from "react"
import { KM_ITB_DIR } from "~/components/layout/brand-assets"
import { cn } from "~/components/ui/cn"
import { StripTitle } from "./display-title"

// Temporary KM ITB files, DESIGN.md
const ART = `${KM_ITB_DIR}/about`
const FILL = "pointer-events-none absolute inset-0 -z-10 size-full select-none"
const ORNAMENT = "pointer-events-none absolute hidden select-none lg:block"

const heroSet = (format: "avif" | "webp") =>
  format === "avif"
    ? `${ART}/hero-720.avif 720w, ${ART}/hero-1440.avif 1440w`
    : `${ART}/hero-720.webp 720w`

/** KM ITB art, else token. */
export function HeroBackdrop({ art }: { art: boolean }) {
  if (!art) return <div aria-hidden="true" className={cn(FILL, "bg-hero")} />
  return (
    <div aria-hidden="true">
      <picture>
        <source type="image/avif" srcSet={heroSet("avif")} sizes="100vw" />
        <img
          src={`${ART}/hero-720.webp`}
          srcSet={heroSet("webp")}
          sizes="100vw"
          width={720}
          height={874}
          alt=""
          fetchPriority="high"
          decoding="async"
          className={cn(FILL, "object-cover")}
        />
      </picture>
      <Sparkle className="top-[30%] left-1/2 w-[150px] -translate-x-[560px] -rotate-30" />
      <Sparkle className="top-[18%] left-1/2 w-[90px] translate-x-[400px] rotate-12" />
    </div>
  )
}

function Sparkle({ className }: { className: string }) {
  return (
    <picture>
      <source type="image/avif" srcSet={`${ART}/sparkle-300.avif`} />
      <img
        src={`${ART}/sparkle-300.webp`}
        width={300}
        height={370}
        alt=""
        loading="lazy"
        decoding="async"
        className={cn(ORNAMENT, "h-auto", className)}
      />
    </picture>
  )
}

/** Mockup ellipse arcs, desktop only. */
export function Arc({
  tone,
  className,
}: {
  tone: "red" | "pink"
  className: string
}) {
  return (
    <img
      src={`${ART}/arc-${tone}.svg`}
      width={tone === "red" ? 71 : 49}
      height={tone === "red" ? 59 : 50}
      alt=""
      aria-hidden="true"
      loading="lazy"
      decoding="async"
      className={cn(ORNAMENT, "h-auto w-[clamp(60px,7vw,140px)]", className)}
    />
  )
}

/** Mockup KotakPastel, centred box. */
export function Panel({
  title,
  art,
  children,
}: {
  title: string
  art: boolean
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        "relative isolate mx-auto mt-6 flex max-w-[700px] flex-col items-center overflow-hidden px-6 py-6 sm:px-8 lg:mt-10 lg:px-12 lg:py-8",
        art ? "shadow-about-panel" : "bg-brand-soft",
      )}
    >
      {art && (
        <img
          src={`${ART}/panel.webp`}
          width={160}
          height={60}
          alt=""
          loading="lazy"
          decoding="async"
          className={cn(FILL, "object-cover")}
        />
      )}
      <StripTitle text={title} glow={art} className="mb-3 lg:mb-4" />
      <div className="max-w-[540px] text-center text-ink leading-[1.7] lg:text-[1.0625rem]">
        {children}
      </div>
    </div>
  )
}

/** Mockup KartuMisi, optional number. */
export function InfoCard({
  number,
  title,
  titleAs: Title = "h4",
  art,
  className,
  children,
}: {
  number?: number
  title?: string
  // Follows the page outline
  titleAs?: "h3" | "h4"
  art: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <li
      className={cn(
        "relative isolate flex flex-col overflow-hidden bg-surface-raised p-5 lg:p-6",
        art ? "shadow-about-card" : "border border-line-subtle",
        className,
      )}
    >
      {art && (
        <img
          src={`${ART}/card.webp`}
          width={96}
          height={90}
          alt=""
          loading="lazy"
          decoding="async"
          className={cn(FILL, "object-cover")}
        />
      )}
      {number !== undefined && (
        <span
          aria-hidden="true"
          className="mb-3 grid size-9 place-items-center bg-brand font-bold text-lg text-on-accent tabular-nums lg:mb-4 lg:size-[42px] lg:text-[1.375rem]"
        >
          {number}
        </span>
      )}
      {title && <Title className="mb-1.5 font-bold text-ink">{title}</Title>}
      <div className="text-[0.95rem] text-ink leading-[1.6]">{children}</div>
    </li>
  )
}
