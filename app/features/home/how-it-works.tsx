import type { CSSProperties } from "react"
import { useStagger } from "~/components/layout/use-reveal"
import { m } from "~/paraglide/messages.js"

const STEPS = [
  m.home_how_step_1,
  m.home_how_step_2,
  m.home_how_step_3,
  m.home_how_step_4,
]

// Mockup BandKM, paints above hero
export function HowItWorks() {
  const list = useStagger<HTMLOListElement>()
  return (
    <section aria-labelledby="cara-kerja" className="relative">
      <div className="mx-auto max-w-6xl px-6 pt-[clamp(1rem,4vw,3rem)] pb-[clamp(5rem,12vw,9rem)] text-center text-on-accent sm:px-10">
        <h2
          id="cara-kerja"
          className="font-bold font-heading text-[clamp(2.25rem,4.45vw,4rem)] leading-[1.2] [font-synthesis-weight:none]"
        >
          {m.home_how_title()}
        </h2>
        <p className="mx-auto mt-4 max-w-3xl leading-[1.7]">
          {m.home_how_lead()}
        </p>
        <ol
          ref={list}
          className="mt-12 grid grid-cols-2 gap-x-8 gap-y-10 lg:grid-cols-4"
        >
          {STEPS.map((step, index) => (
            <li
              key={step()}
              style={{ "--i": index } as CSSProperties}
              className="flex flex-col items-center"
            >
              <span
                aria-hidden="true"
                className="font-bold text-[clamp(2.2rem,4vw,3.4rem)] tabular-nums leading-none"
              >
                {String(index + 1).padStart(2, "0")}
              </span>
              <p className="mt-2 text-on-accent/80">{step()}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
