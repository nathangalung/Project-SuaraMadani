import { Check, Copy } from "lucide-react"
import { useEffect, useState } from "react"
import { Button } from "~/components/ui/button"
import { useToast } from "~/components/ui/toast"
import { m } from "~/paraglide/messages.js"
import { useHydrated } from "./hydrated"

const COPIED_RESET_MS = 2000

// Space reserved, no shift
export function CopyCode({ code }: { code: string }) {
  const hydrated = useHydrated()
  const toast = useToast()
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), COPIED_RESET_MS)
    return () => clearTimeout(timer)
  }, [copied])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
    } catch {
      // Denied: code stays visible
      return
    }
    setCopied(true)
    toast(m.success_copied_toast())
  }

  return (
    <div className="mt-4 h-9 print:hidden">
      {hydrated && "clipboard" in navigator && (
        <Button variant="secondary" size="sm" onClick={copy} className="group">
          {copied ? (
            <Check
              aria-hidden="true"
              className="size-4 text-success group-hover:text-mint"
            />
          ) : (
            <Copy aria-hidden="true" className="size-4" />
          )}
          {copied ? m.success_copied() : m.success_copy()}
        </Button>
      )}
    </div>
  )
}
