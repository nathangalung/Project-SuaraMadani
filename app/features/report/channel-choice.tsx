import { Mail, MessageCircle } from "lucide-react"
import type { ReactNode } from "react"
import { Fieldset } from "~/components/ui/field"
import { m } from "~/paraglide/messages.js"
import type { Destination } from "../../../shared/phone.ts"
import type { OtpChannel } from "../../../shared/whatsapp.ts"

export const CHANNEL_GROUP_ID = "signin-channel"

const CARD =
  "group flex cursor-pointer items-center gap-4 rounded-[10px] border-2 border-line bg-surface-raised p-4 transition-[border-color,background-color] duration-150 hover:border-ink has-[:checked]:border-brand has-[:checked]:bg-brand-soft has-[:disabled]:cursor-not-allowed has-[:disabled]:hover:border-line motion-reduce:transition-none"
// Note stays full contrast
const DIM = "group-has-[:disabled]:opacity-70"

export type ChannelOptions = {
  email: Destination
  whatsapp: Destination
  whatsappReady: boolean
  // Unproven identifier held elsewhere
  only?: OtpChannel | null
}

function notes(options: ChannelOptions) {
  return {
    email: !options.email
      ? m.signin_email_missing()
      : options.only === "whatsapp"
        ? m.signin_email_pending()
        : undefined,
    whatsapp: !options.whatsapp
      ? m.signin_whatsapp_missing()
      : !options.whatsappReady
        ? m.signin_whatsapp_unavailable()
        : options.only === "email"
          ? m.signin_whatsapp_pending()
          : undefined,
  }
}

const REGISTERED = {
  email: () => m.signin_email_registered(),
  whatsapp: () => m.signin_whatsapp_registered(),
}

/** Mask, else account line. */
function detailOf(channel: OtpChannel, destination: Destination) {
  if (!destination) return null
  return destination.kind === "masked"
    ? destination.value
    : REGISTERED[channel]()
}

/** Channels the person may pick. */
export function openChannels(options: ChannelOptions): OtpChannel[] {
  const note = notes(options)
  return (["email", "whatsapp"] as const).filter((c) => !note[c])
}

/** Checked if open, else first. */
export function channelFocusId(
  options: ChannelOptions,
  value: OtpChannel | undefined,
): string | null {
  const open = openChannels(options)
  const target = value && open.includes(value) ? value : open[0]
  return target ? `${CHANNEL_GROUP_ID}-${target}` : null
}

function Option({
  value,
  icon,
  title,
  detail,
  note,
  checked,
  disabled,
  onChange,
}: {
  value: OtpChannel
  icon: ReactNode
  title: string
  detail: string | null
  note?: string
  checked: boolean
  disabled: boolean
  onChange: (value: OtpChannel) => void
}) {
  const id = `${CHANNEL_GROUP_ID}-${value}`
  return (
    <label htmlFor={id} className={CARD}>
      <input
        id={id}
        type="radio"
        name="channel"
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={() => onChange(value)}
        aria-describedby={`${id}-detail`}
        className="size-5 shrink-0 cursor-pointer accent-brand disabled:cursor-not-allowed"
      />
      <span
        aria-hidden="true"
        className={`grid size-11 shrink-0 place-items-center rounded-full bg-surface text-ink ${DIM}`}
      >
        {icon}
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className={`font-bold font-heading text-lg ${DIM}`}>{title}</span>
        <span
          id={`${id}-detail`}
          className="font-ui text-ink-muted text-sm tabular-nums wrap-anywhere"
        >
          {note ?? detail}
        </span>
      </span>
    </label>
  )
}

/** Two large options, masked. */
export function ChannelChoice({
  value,
  onChange,
  error,
  legendHidden,
  ...options
}: ChannelOptions & {
  value: OtpChannel | undefined
  onChange: (value: OtpChannel) => void
  error?: string
  legendHidden?: boolean
}) {
  const note = notes(options)
  return (
    <Fieldset
      id={CHANNEL_GROUP_ID}
      legend={m.signin_channel_legend()}
      error={error}
      legendHidden={legendHidden}
      optionsClassName="grid gap-3"
    >
      <Option
        value="email"
        icon={<Mail className="size-5" />}
        title={m.signin_channel_email()}
        detail={detailOf("email", options.email)}
        note={note.email}
        checked={value === "email"}
        disabled={note.email !== undefined}
        onChange={onChange}
      />
      <Option
        value="whatsapp"
        icon={<MessageCircle className="size-5" />}
        title={m.signin_channel_whatsapp()}
        detail={detailOf("whatsapp", options.whatsapp)}
        note={note.whatsapp}
        checked={value === "whatsapp"}
        disabled={note.whatsapp !== undefined}
        onChange={onChange}
      />
    </Fieldset>
  )
}
