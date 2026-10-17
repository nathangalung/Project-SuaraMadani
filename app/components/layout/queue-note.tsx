import { Note } from "~/components/ui/note"
import { m } from "~/paraglide/messages.js"

// PLAN §5.10, /lapor and /lacak
export function QueueNote({ className }: { className?: string }) {
  return (
    <Note tone="info" className={className}>
      <strong className="font-semibold">{m.queue_slow_title()}</strong>{" "}
      {m.queue_slow_body()}
    </Note>
  )
}
