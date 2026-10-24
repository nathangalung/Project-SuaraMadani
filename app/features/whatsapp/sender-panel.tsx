import { Link2, Link2Off, QrCode, Smartphone } from "lucide-react"
import type { ReactNode } from "react"
import { Form } from "react-router"
import { Badge, type BadgeTone } from "~/components/ui/badge"
import { Button } from "~/components/ui/button"
import { TextInput } from "~/components/ui/field"
import { Note } from "~/components/ui/note"
import { useSubmitting } from "~/features/moderation/submitting"
import { m } from "~/paraglide/messages.js"
import { formatDateTime } from "../../../shared/format.ts"
import type { WhatsAppStatus } from "../../../shared/whatsapp.ts"
import type { QrPath, SenderView } from "./admin.server"

export const WA_PHONE_ID = "wa-pairing-phone"

const STATUS: Record<WhatsAppStatus, { text: () => string; tone: BadgeTone }> =
  {
    unlinked: { text: m.wa_status_unlinked, tone: "neutral" },
    linking: { text: m.wa_status_linking, tone: "soft" },
    connected: { text: m.wa_status_connected, tone: "success" },
    disconnected: { text: m.wa_status_disconnected, tone: "danger" },
    logged_out: { text: m.wa_status_logged_out, tone: "danger" },
    stopped: { text: m.wa_status_stopped, tone: "neutral" },
  }

const PROVIDER_NAME: Record<string, () => string> = {
  meta: () => "Meta Cloud API",
  dev: m.wa_provider_dev,
}

/** Worker stores codes, not text. */
export function faultText(code: string | null): string {
  if (code === null) return m.wa_fault_none()
  if (code === "logged_out") return m.wa_fault_logged_out()
  if (code === "link_timeout") return m.wa_fault_link_timeout()
  const closed = /^disconnected:(.+)$/.exec(code)
  return closed?.[1] ? m.wa_fault_disconnected({ code: closed[1] }) : code
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-ink-muted">{label}</dt>
      <dd className="font-semibold">{children}</dd>
    </>
  )
}

/** Status, service, number, errors. */
export function SenderState({ view }: { view: SenderView }) {
  const status = STATUS[view.status]
  return (
    <dl className="grid grid-cols-[minmax(0,10rem)_1fr] items-center gap-x-6 gap-y-3 text-sm">
      <Row label={m.wa_status()}>
        <Badge tone={status.tone}>{status.text()}</Badge>
      </Row>
      <Row label={m.wa_service()}>
        {view.running ? m.wa_service_running() : m.wa_service_stopped()}
      </Row>
      <Row label={m.wa_number()}>
        <span className="tabular-nums">
          {view.linkedPhone ?? m.wa_number_none()}
        </span>
      </Row>
      <Row label={m.wa_last_connected()}>
        {view.lastConnectedAt
          ? formatDateTime(view.lastConnectedAt)
          : m.wa_never()}
      </Row>
      <Row label={m.wa_fault_last()}>
        <span className="break-words font-normal">
          {faultText(view.lastError)}
        </span>
      </Row>
    </dl>
  )
}

function QrImage({ qr }: { qr: QrPath }) {
  return (
    <svg
      role="img"
      aria-label={m.wa_qr_label()}
      viewBox={`0 0 ${qr.size} ${qr.size}`}
      shapeRendering="crispEdges"
      className="confirm-in size-64 bg-white p-2 text-black"
    >
      <path d={qr.path} fill="currentColor" />
    </svg>
  )
}

/** QR or pairing code. */
export function LinkingStep({ view }: { view: SenderView }) {
  if (view.qr) {
    return (
      <div className="flex flex-col items-start gap-4">
        <QrImage qr={view.qr} />
        <p className="max-w-prose text-ink-muted text-sm">{m.wa_qr_steps()}</p>
      </div>
    )
  }
  if (view.pairingCode) {
    const code = view.pairingCode
    return (
      <div className="flex flex-col items-start gap-4">
        <p className="confirm-in font-bold font-mono text-4xl tracking-[0.3em]">
          {`${code.slice(0, 4)}-${code.slice(4)}`}
        </p>
        <p className="max-w-prose text-ink-muted text-sm">
          {m.wa_code_steps()}
        </p>
      </div>
    )
  }
  return null
}

const CARD =
  "flex flex-col gap-4 border border-line-subtle bg-surface-raised p-5"

/** Two ways to link. */
export function LinkForms({ phoneError }: { phoneError?: string }) {
  const qrBusy = useSubmitting("link_qr")
  const codeBusy = useSubmitting("link_code")
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Form method="post" className={CARD}>
        <input type="hidden" name="intent" value="link_qr" />
        <div className="flex items-center gap-3">
          <QrCode aria-hidden="true" className="size-5 text-accent" />
          <h3 className="font-bold text-lg">{m.wa_link_qr_title()}</h3>
        </div>
        <p className="text-ink-muted text-sm">{m.wa_link_qr_lead()}</p>
        <div className="mt-auto">
          <Button type="submit" variant="secondary" pending={qrBusy}>
            {m.wa_link_qr()}
          </Button>
        </div>
      </Form>
      <Form method="post" className={CARD} noValidate>
        <input type="hidden" name="intent" value="link_code" />
        <div className="flex items-center gap-3">
          <Smartphone aria-hidden="true" className="size-5 text-accent" />
          <h3 className="font-bold text-lg">{m.wa_link_code_title()}</h3>
        </div>
        <p className="text-ink-muted text-sm">{m.wa_link_code_lead()}</p>
        <TextInput
          id={WA_PHONE_ID}
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="off"
          label={m.wa_link_phone()}
          hint={m.wa_link_phone_hint()}
          error={phoneError}
          requiredMark
        />
        <div>
          <Button type="submit" variant="secondary" pending={codeBusy}>
            <Link2 aria-hidden="true" className="size-4" />
            {m.wa_link_code()}
          </Button>
        </div>
      </Form>
    </div>
  )
}

export function UnlinkForm() {
  const busy = useSubmitting("unlink")
  return (
    <Form method="post" className={CARD}>
      <input type="hidden" name="intent" value="unlink" />
      <p className="text-ink-muted text-sm">{m.wa_unlink_lead()}</p>
      <div>
        <Button type="submit" variant="danger" pending={busy}>
          <Link2Off aria-hidden="true" className="size-4" />
          {m.wa_unlink()}
        </Button>
      </div>
    </Form>
  )
}

/** Meta, dev: no link. */
export function FixedProviderNote({ provider }: { provider: string }) {
  return (
    <Note tone="info">
      {m.wa_fixed_note({ provider: PROVIDER_NAME[provider]?.() ?? provider })}
    </Note>
  )
}
