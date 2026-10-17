import { m } from "../app/paraglide/messages.js"
import { OTP_TTL_SECONDS } from "../shared/whatsapp.ts"

/** Plain, short, no link. */
export function whatsappCodeText(code: string): string {
  return m.wa_code_text({ code, minutes: OTP_TTL_SECONDS / 60 })
}
