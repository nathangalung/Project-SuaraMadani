import { cn } from "../ui/cn"
import { useReveal } from "./use-reveal"

const tones = {
  brand: "bg-brand",
  ink: "bg-ink",
} as const

// Mockup JudulKotak, centred box
export function BoxedHeading({
  id,
  tone,
  children,
}: {
  id: string
  tone: keyof typeof tones
  children: string
}) {
  const ref = useReveal<HTMLHeadingElement>()
  return (
    <h2
      ref={ref}
      id={id}
      className="text-center font-bold font-heading text-[clamp(1.9rem,4.6vw,3.4rem)] text-on-accent leading-[1.15] [font-synthesis-weight:none]"
    >
      <span className={cn("highlight-box", tones[tone])}>{children}</span>
    </h2>
  )
}
