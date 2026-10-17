import { normalizeHost } from "../db/tenant.server.ts"

/** Absolute URLs from tenant.host only. */
export function originFor(host: string): string {
  return `${process.env.NODE_ENV === "production" ? "https" : "http"}://${host}`
}

/** Tenants live under it. */
export function apexHost(): string {
  return normalizeHost(process.env.APEX_HOST || "localhost")
}
