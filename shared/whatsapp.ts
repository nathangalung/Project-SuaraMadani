// Zod-free for small client chunks.

export const OTP_CHANNELS = ["email", "whatsapp"] as const
export type OtpChannel = (typeof OTP_CHANNELS)[number]

export const WHATSAPP_STATUSES = [
  "unlinked",
  "linking",
  "connected",
  "disconnected",
  "logged_out",
  // Graceful shutdown: deploy or lever
  "stopped",
] as const
export type WhatsAppStatus = (typeof WHATSAPP_STATUSES)[number]

export const WHATSAPP_REQUESTS = ["link_qr", "link_code", "unlink"] as const
export type WhatsAppRequest = (typeof WHATSAPP_REQUESTS)[number]

export const WHATSAPP_LOG_STATUSES = ["reserved", "sent", "failed"] as const
export type WhatsAppLogStatus = (typeof WHATSAPP_LOG_STATUSES)[number]

export const WHATSAPP_LOG_ERRORS = [
  "expired",
  "unavailable",
  "not_on_whatsapp",
  "provider",
] as const
export type WhatsAppLogError = (typeof WHATSAPP_LOG_ERRORS)[number]

// sign_up: any unproven destination
export const OTP_PURPOSES = ["sign_in", "sign_up"] as const
export type OtpPurpose = (typeof OTP_PURPOSES)[number]

// Starting Values: ban risk limits
export const WHATSAPP_LIMITS = {
  // Per number and client
  spacingMs: 60_000,
  perDay: 8,
  // Proven number, all clients
  perNumberDayAllClients: 20,
  // Whole sender
  perHour: 60,
  perDayTotal: 300,
  // Daftar share, rest for sign-in
  signUpPerHour: 20,
  signUpPerDay: 100,
  // Per IPv4 or IPv6 /64
  signUpPerClientDay: 5,
  // Worker gap between sends
  gapMs: 3_000,
} as const

// Worker heartbeat every 30 s
export const WHATSAPP_FRESH_MS = 90_000

export const OTP_TTL_SECONDS = 300

/** Sender usable for codes now. */
export function whatsappReady(
  row: { status: WhatsAppStatus; lastSeenAt: Date | null } | undefined,
  now: Date,
): boolean {
  if (row?.status !== "connected" || !row.lastSeenAt) return false
  return now.getTime() - row.lastSeenAt.getTime() <= WHATSAPP_FRESH_MS
}
