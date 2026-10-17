import { useEffect, useRef, useState } from "react"
import { Button } from "~/components/ui/button"
import { m } from "~/paraglide/messages.js"

type RenderOptions = {
  sitekey: string
  language: string
  "response-field": boolean
  callback: (token: string) => void
  "expired-callback": () => void
  "error-callback": () => void
}
type TurnstileApi = {
  render: (element: HTMLElement, options: RenderOptions) => string
  remove: (widgetId: string) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

const SCRIPT =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
let loading: Promise<TurnstileApi> | undefined

// Inserted by trusted code: strict-dynamic
function loadTurnstile(): Promise<TurnstileApi> {
  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    if (window.turnstile) return resolve(window.turnstile)
    const script = document.createElement("script")
    script.src = SCRIPT
    script.onload = () =>
      window.turnstile
        ? resolve(window.turnstile)
        : reject(new Error("turnstile missing"))
    script.onerror = () => reject(new Error("turnstile load failed"))
    document.head.append(script)
  }).catch((error: unknown) => {
    loading = undefined
    throw error
  })
  return loading
}

/** Submit refusal while no token. */
export function captchaWait(loadFailed: boolean): string {
  return loadFailed ? m.error_captcha_unavailable() : m.error_captcha_pending()
}

type TurnstileProps = {
  siteKey: string
  onToken: (token: string | null) => void
  onLoadFailed: (failed: boolean) => void
}

// Key remount gives fresh token
export function Turnstile({ siteKey, onToken, onLoadFailed }: TurnstileProps) {
  const ref = useRef<HTMLDivElement>(null)
  const tokenRef = useRef(onToken)
  tokenRef.current = onToken
  const failedRef = useRef(onLoadFailed)
  failedRef.current = onLoadFailed
  const [attempt, setAttempt] = useState(0)
  const [failed, setFailed] = useState(false)

  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt reruns the load
  useEffect(() => {
    let widgetId: string | undefined
    let cancelled = false
    tokenRef.current(null)
    loadTurnstile()
      .then((api) => {
        if (cancelled || !ref.current) return
        widgetId = api.render(ref.current, {
          sitekey: siteKey,
          language: "id",
          "response-field": false,
          callback: (token) => tokenRef.current(token),
          "expired-callback": () => tokenRef.current(null),
          "error-callback": () => tokenRef.current(null),
        })
      })
      .catch(() => {
        tokenRef.current(null)
        if (cancelled) return
        setFailed(true)
        failedRef.current(true)
      })
    return () => {
      cancelled = true
      if (widgetId) window.turnstile?.remove(widgetId)
    }
  }, [siteKey, attempt])

  const retry = () => {
    setFailed(false)
    failedRef.current(false)
    setAttempt((value) => value + 1)
  }

  return (
    <fieldset className="min-h-16 min-w-0">
      <legend className="sr-only">{m.security_check()}</legend>
      <div ref={ref} />
      {failed && (
        <Button variant="secondary" onClick={retry}>
          {m.security_check_retry()}
        </Button>
      )}
    </fieldset>
  )
}
