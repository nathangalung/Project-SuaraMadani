import type { EmailSender } from "../../server/email.ts"
import { whatsappCodeText } from "../../server/whatsapp-text.ts"
import type { WhatsAppProvider } from "./provider.ts"

/** Dev inbox: Mailpit, never WhatsApp. */
export function devProvider(inbox: EmailSender): WhatsAppProvider {
  return {
    name: "dev",
    async send({ to, code }) {
      const text = whatsappCodeText(code)
      await inbox.send({
        to: `wa-${to.replace(/^\+/, "")}@whatsapp.localhost`,
        subject: `WhatsApp ke ${to}`,
        text,
        html: `<p>${text}</p>`,
      })
      return "sent"
    },
  }
}
