import { sql } from "drizzle-orm"
import {
  check,
  customType,
  index,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core"
import {
  OTP_PURPOSES,
  type OtpPurpose,
  WHATSAPP_LOG_ERRORS,
  WHATSAPP_LOG_STATUSES,
  WHATSAPP_REQUESTS,
  WHATSAPP_STATUSES,
  type WhatsAppLogError,
  type WhatsAppLogStatus,
  type WhatsAppRequest,
  type WhatsAppStatus,
} from "../../shared/whatsapp.ts"
import { users } from "./auth.ts"
import { createdAt, oneOf, primaryId, updatedAt } from "./columns.ts"

// Global tables, outside RLS

const at = (name: string) => timestamp(name, { withTimezone: true })
const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" })

// Like email_log: caps and status
export const whatsappLog = pgTable(
  "whatsapp_log",
  {
    id: primaryId(),
    // HMAC, never the number
    phoneHash: text("phone_hash").notNull(),
    status: text("status").$type<WhatsAppLogStatus>().notNull(),
    error: text("error").$type<WhatsAppLogError>(),
    purpose: text("purpose").$type<OtpPurpose>().notNull().default("sign_in"),
    // HMAC of IPv4 or /64
    clientHash: text("client_hash"),
    createdAt: createdAt(),
    sentAt: at("sent_at"),
  },
  (t) => [
    index("whatsapp_log_created_idx").on(t.createdAt),
    index("whatsapp_log_phone_idx").on(t.phoneHash, t.createdAt),
    check("whatsapp_log_status_check", oneOf(t.status, WHATSAPP_LOG_STATUSES)),
    check("whatsapp_log_error_check", oneOf(t.error, WHATSAPP_LOG_ERRORS)),
    check("whatsapp_log_purpose_check", oneOf(t.purpose, OTP_PURPOSES)),
  ],
)

// One sender, row id 1
export const whatsappSender = pgTable(
  "whatsapp_sender",
  {
    id: smallint("id").primaryKey().default(1),
    provider: text("provider").notNull(),
    status: text("status").$type<WhatsAppStatus>().notNull(),
    requested: text("requested").$type<WhatsAppRequest>(),
    requestedBy: uuid("requested_by").references(() => users.id, {
      onDelete: "set null",
    }),
    // E.164 for a pairing code
    pairingPhone: text("pairing_phone"),
    qr: text("qr"),
    pairingCode: text("pairing_code"),
    // Masked, display only
    linkedPhone: text("linked_phone"),
    lastConnectedAt: at("last_connected_at"),
    lastSeenAt: at("last_seen_at"),
    lastError: text("last_error"),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("whatsapp_sender_singleton_check", sql`${t.id} = 1`),
    check("whatsapp_sender_status_check", oneOf(t.status, WHATSAPP_STATUSES)),
    check(
      "whatsapp_sender_requested_check",
      oneOf(t.requested, WHATSAPP_REQUESTS),
    ),
  ],
)

// Baileys auth state, sealed
export const whatsappAuth = pgTable("whatsapp_auth", {
  key: text("key").primaryKey(),
  value: bytea("value").notNull(),
  updatedAt: updatedAt(),
})
