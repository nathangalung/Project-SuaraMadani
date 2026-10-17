import { Fragment } from "react"
import { cn } from "~/components/ui/cn"

const DISPLAY = "text-on-accent uppercase [font-synthesis:none]"

/** Tilt Warp already heavy. */
export function displayWeight(art: boolean): string {
  return art ? "font-normal" : "font-bold"
}

// Mockup HurufCampur, per word
export function MixedLetters({ text }: { text: string }) {
  return text.split(/(\s+)/).map((word, index) => {
    const key = `${index}-${word}`
    if (!/^\p{L}/u.test(word)) {
      return word.trim() ? (
        <span key={key} className="font-body">
          {word}
        </span>
      ) : (
        <Fragment key={key}>{word}</Fragment>
      )
    }
    return (
      <Fragment key={key}>
        <span className="font-body">{word.slice(0, 1)}</span>
        <span className="font-heading">{word.slice(1)}</span>
      </Fragment>
    )
  })
}

/** Full-width chapter band. */
export function BandTitle({
  id,
  text,
  glow,
}: {
  id: string
  text: string
  glow: boolean
}) {
  return (
    <div className="bg-brand px-4 pt-8 pb-2 lg:pt-2 lg:pb-3">
      <h2
        id={id}
        className={cn(
          DISPLAY,
          displayWeight(glow),
          "text-center text-[2.25rem] leading-[1.2] sm:text-[3.25rem] md:text-[4rem] lg:text-[4.9rem]",
          glow && "title-glow",
        )}
      >
        <MixedLetters text={text} />
      </h2>
    </div>
  )
}

/** Title on brand strip. */
export function StripTitle({
  id,
  text,
  glow,
  className,
}: {
  id?: string
  text: string
  glow: boolean
  className?: string
}) {
  return (
    <h3 id={id} className={cn("relative z-10 flex justify-center", className)}>
      <span className="relative isolate inline-block px-1 lg:px-2">
        {/* Full strip without the glow */}
        <span
          aria-hidden="true"
          className={cn(
            "absolute inset-x-0 bottom-0 -z-10 bg-brand",
            glow ? "top-[35%]" : "top-0",
          )}
        />
        <span
          className={cn(
            DISPLAY,
            displayWeight(glow),
            "block text-center text-[clamp(1.75rem,4vw,3rem)] leading-[1.1]",
            glow && "title-glow",
          )}
        >
          <MixedLetters text={text} />
        </span>
      </span>
    </h3>
  )
}
