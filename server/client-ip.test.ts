import { describe, expect, test } from "bun:test"
import { trustClientIp } from "./client-ip.ts"

const CADDY = "172.31.11.10"

function request(ip: string | null) {
  return new Request("http://itb.localhost/lapor", {
    method: "POST",
    headers: ip ? { "x-client-ip": ip, origin: "http://itb.localhost" } : {},
    body: "isi",
  })
}

describe("trustClientIp", () => {
  test("Caddy's header passes through", () => {
    const req = request("203.0.113.9")
    expect(trustClientIp(req, CADDY, CADDY)).toBe(req)
    // Dual-stack socket, mapped address
    expect(trustClientIp(req, `::ffff:${CADDY}`, CADDY)).toBe(req)
  })

  test("any other peer loses the header", async () => {
    const req = trustClientIp(request("203.0.113.9"), "172.31.11.20", CADDY)
    expect(req.headers.get("x-client-ip")).toBeNull()
    expect(req.headers.get("origin")).toBe("http://itb.localhost")
    expect(req.method).toBe("POST")
    expect(await req.text()).toBe("isi")
  })

  test("unknown peer loses the header", () => {
    const req = trustClientIp(request("203.0.113.9"), null, CADDY)
    expect(req.headers.get("x-client-ip")).toBeNull()
  })

  test("unset proxy trusts as before", () => {
    const req = request("203.0.113.9")
    expect(trustClientIp(req, "10.0.0.1", undefined)).toBe(req)
  })
})
