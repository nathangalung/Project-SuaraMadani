// Swappable by WHATSAPP_PROVIDER

export type WhatsAppMessage = { to: string; code: string }

// Throw for transient errors
export type SendResult = "sent" | "not_on_whatsapp" | "unavailable"

export type ProviderName = "baileys" | "meta" | "dev"

export type WhatsAppProvider = {
  name: ProviderName
  send: (message: WhatsAppMessage, signal: AbortSignal) => Promise<SendResult>
}

const PROVIDERS: readonly ProviderName[] = ["baileys", "meta", "dev"]

/** Unknown names fail at boot. */
export function providerName(value: string | undefined): ProviderName {
  const name = (value ?? "").trim()
  const found = PROVIDERS.find((known) => known === name)
  if (!found)
    throw new Error(`WHATSAPP_PROVIDER must be ${PROVIDERS.join(", ")}`)
  return found
}
