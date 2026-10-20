import { Note } from "~/components/ui/note"
import { m } from "~/paraglide/messages.js"
import type { NeutralFinding } from "../../../shared/neutral-language.ts"

function findingText(finding: NeutralFinding): string {
  if (finding.kind === "word") return m.demand_neutral_word(finding)
  if (finding.kind === "exclamation") return m.demand_neutral_exclamation()
  return m.demand_neutral_shouting()
}

/** Advice only, publish stays open. */
export function NeutralNotice({
  findings,
  className,
}: {
  findings: NeutralFinding[]
  className?: string
}) {
  if (findings.length === 0) return null
  return (
    <Note tone="info" className={className}>
      <h2 className="font-bold">{m.demand_neutral_title()}</h2>
      <ul className="mt-1 list-disc pl-5">
        {findings.map((finding) => (
          <li key={finding.kind === "word" ? finding.word : finding.kind}>
            {findingText(finding)}
          </li>
        ))}
      </ul>
      <p className="mt-2">{m.demand_neutral_advice()}</p>
    </Note>
  )
}
