import { type FetchLike, withDeadline } from "../../server/http.ts"
import type { WhatsAppProvider } from "./provider.ts"

// Graph version from Meta docs
const GRAPH = "https://graph.facebook.com/v25.0"
const TIMEOUT_MS = 10_000
// Not a WhatsApp account
const UNDELIVERABLE = 131026

export type MetaConfig = {
  token: string
  phoneNumberId: string
  // Approved copy-code template
  template: string
  language: string
  fetch?: FetchLike
}

/** Status only, never the body. */
class MetaSendError extends Error {
  readonly status: number
  constructor(status: number) {
    super(`meta send failed: ${status}`)
    this.name = "MetaSendError"
    this.status = status
  }
}

/** Official Cloud API, template only. */
export function metaProvider(config: MetaConfig): WhatsAppProvider {
  const fetch = config.fetch ?? globalThis.fetch
  return {
    name: "meta",
    async send({ to, code }, signal) {
      const parameters = [{ type: "text", text: code }]
      const response = await withDeadline(
        fetch(`${GRAPH}/${config.phoneNumberId}/messages`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${config.token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: to.replace(/^\+/, ""),
            type: "template",
            template: {
              name: config.template,
              language: { code: config.language },
              components: [
                { type: "body", parameters },
                { type: "button", sub_type: "url", index: "0", parameters },
              ],
            },
          }),
          signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]),
        }),
        TIMEOUT_MS,
      )
      if (response.ok) return "sent"
      const body = (await response.json().catch(() => ({}))) as {
        error?: { code?: unknown }
      }
      if (body.error?.code === UNDELIVERABLE) return "not_on_whatsapp"
      throw new MetaSendError(response.status)
    },
  }
}
