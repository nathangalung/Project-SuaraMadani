import { m } from "~/paraglide/messages.js"

// Offscreen until focused, two-colour ring
export function SkipLink() {
  return (
    <a
      href="#konten"
      className="fixed -top-24 left-3 z-[2000] bg-highlight px-4 py-3 font-semibold text-ink underline underline-offset-4 focus:top-3 focus-visible:outline-ink focus-visible:outline-offset-0"
    >
      {m.skip_to_content()}
    </a>
  )
}
