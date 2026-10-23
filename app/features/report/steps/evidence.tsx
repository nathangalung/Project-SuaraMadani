import { useEffect, useState } from "react"
import { Note } from "~/components/ui/note"
import { m } from "~/paraglide/messages.js"
import { browserStorage, type Draft, entryOf, memory, saveStep } from "../draft"
import { EvidencePicker } from "../evidence-picker"
import { errorText, StepPage, useStepNav } from "../step-page"
import { missingEntries, type StepError, validateEvidence } from "../validate"
import { ensureVideoMeta } from "../video-meta"

export function EvidenceStep({ draft }: { draft: Draft }) {
  const { next } = useStepNav("evidence")
  const [errors, setErrors] = useState<StepError[]>([])
  const [files, setFiles] = useState<File[]>(memory.files)
  // Re-render once durations load
  const [, setMetaRead] = useState(0)
  const missing = missingEntries(draft.evidence, files)

  useEffect(() => {
    let live = true
    void ensureVideoMeta(files).then(() => {
      if (live) setMetaRead((n) => n + 1)
    })
    return () => {
      live = false
    }
  }, [files])

  const onContinue = async () => {
    await ensureVideoMeta(files)
    const manifest = files.map(entryOf)
    const found = validateEvidence(manifest)
    setErrors(found)
    if (found.length > 0) return
    memory.files = files
    saveStep(browserStorage(), draft, "evidence", manifest)
    next()
  }

  return (
    <StepPage
      step="evidence"
      requiredNote={false}
      title={m.step_evidence_title()}
      errors={errors}
      setErrors={setErrors}
      onContinue={onContinue}
    >
      <Note>
        <p className="font-semibold">{m.evidence_warning()}</p>
      </Note>
      <EvidencePicker
        files={files}
        onChange={setFiles}
        missing={missing}
        error={errorText(errors, "evidence")}
      />
    </StepPage>
  )
}
