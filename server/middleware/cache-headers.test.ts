import { describe, expect, test } from "bun:test"
import {
  applyCacheHeaders,
  cachePolicy,
  hasSessionCookie,
} from "./cache-headers.ts"

const base = {
  path: "/isu",
  method: "GET",
  status: 200,
  hasSession: false,
  setsCookie: false,
  routeSet: false,
}

describe("cachePolicy", () => {
  test("anonymous 200 and canonical 301 are public", () => {
    expect(cachePolicy(base)).toBe("public")
    expect(cachePolicy({ ...base, status: 301 })).toBe("public")
  })

  test("errors are never stored", () => {
    for (const status of [400, 403, 404, 410, 500, 503]) {
      expect(cachePolicy({ ...base, status })).toBe("none")
    }
    expect(cachePolicy({ ...base, status: 503, hasSession: true })).toBe("none")
  })

  test("private routes, sessions, cookies and writes are private", () => {
    for (const path of [
      "/lapor",
      "/lapor/lokasi",
      "/lapor/sukses/LPR-2026-10-0001",
      "/lacak",
      "/masuk",
      "/isu/ISU-2026-10-0042/laporkan",
      "/isu/ISU-2026-10-0042/berhenti",
      "/isu/ISU-2026-10-0042/nilai",
      "/isu/ISU-2026-10-0042/survei",
      "/isu/ISU-2026-10-0042/hak-jawab",
      "/tuntutan/TUN-ITB-26-0001/laporkan",
      "/tuntutan/TUN-ITB-26-0001/berhenti",
      "/tuntutan/TUN-ITB-26-0001/nilai",
      "/kelola/tuntutan",
      "/aduan/ADU-ITB-26-7K3QX",
      "/undangan/0199c2b0-1d2e-7000-8000-000000000001",
      "/kelola",
      "/kelola/anggota",
      "/kelola/antrean",
      "/admin",
      "/api/auth/get-session",
      "/api/upload/abc",
      "/healthz",
      "/healthz/jobs",
    ]) {
      expect(cachePolicy({ ...base, path })).toBe("private")
    }
    expect(cachePolicy({ ...base, hasSession: true })).toBe("private")
    expect(cachePolicy({ ...base, setsCookie: true })).toBe("private")
    expect(cachePolicy({ ...base, method: "POST" })).toBe("private")
  })

  test("the public data API is cacheable, other /api is not", () => {
    for (const path of [
      "/api/v1",
      "/api/v1/isu",
      "/api/v1/isu/ISU-2026-10-0042",
      "/api/v1/data/tren.csv",
    ]) {
      expect(cachePolicy({ ...base, path })).toBe("public")
    }
    for (const path of ["/api/v1x", "/api/v2/isu", "/api/auth/v1/x"]) {
      expect(cachePolicy({ ...base, path })).toBe("private")
    }
  })

  test("lookalike paths stay public", () => {
    expect(cachePolicy({ ...base, path: "/laporan-tahunan" })).toBe("public")
    expect(cachePolicy({ ...base, path: "/isu/laporkan-x" })).toBe("public")
    expect(cachePolicy({ ...base, path: "/aduanku" })).toBe("public")
    expect(cachePolicy({ ...base, path: "/tuntutan" })).toBe("public")
    expect(cachePolicy({ ...base, path: "/tuntutan/TUN-ITB-26-0001" })).toBe(
      "public",
    )
  })

  test("a route's own header is kept only when public is allowed", () => {
    expect(cachePolicy({ ...base, routeSet: true })).toBe("keep")
    expect(cachePolicy({ ...base, routeSet: true, hasSession: true })).toBe(
      "private",
    )
  })

  test("other statuses are not stored", () => {
    expect(cachePolicy({ ...base, status: 302 })).toBe("none")
    expect(cachePolicy({ ...base, status: 204 })).toBe("none")
  })
})

describe("applyCacheHeaders", () => {
  test("public pair on 200", () => {
    const headers = new Headers()
    applyCacheHeaders(headers, "public", 60)
    expect(headers.get("Cache-Control")).toBe("public, max-age=0, no-transform")
    expect(headers.get("Cloudflare-CDN-Cache-Control")).toBe(
      "max-age=60, stale-while-revalidate=30, stale-if-error=86400",
    )
  })

  test("private and none drop the CDN header", () => {
    const headers = new Headers({
      "Cloudflare-CDN-Cache-Control": "max-age=86400",
    })
    applyCacheHeaders(headers, "private", 60)
    expect(headers.get("Cache-Control")).toBe("private, no-store")
    expect(headers.has("Cloudflare-CDN-Cache-Control")).toBe(false)
    applyCacheHeaders(headers, "none", 60)
    expect(headers.get("Cache-Control")).toBe("no-store")
  })
})

describe("hasSessionCookie", () => {
  test("matches the dev and prod names only", () => {
    expect(hasSessionCookie("sb.session_token=abc")).toBe(true)
    expect(hasSessionCookie("a=1; __Secure-sb.session_token=abc")).toBe(true)
    expect(hasSessionCookie("a=1; __Host-sb.session_token=abc")).toBe(true)
    expect(hasSessionCookie("__cf_bm=x; xsm.session_token=1")).toBe(false)
    expect(hasSessionCookie(null)).toBe(false)
  })
})
