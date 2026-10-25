import { describe, expect, test } from "bun:test"
import { inRequestScope } from "../../../db/request-scope.ts"
import { signOut } from "./sign-out.server.ts"

const cleared = "sb.session_token=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax"

function fakeSignOut(response: Response) {
  const calls: Headers[] = []
  return {
    calls,
    signOut: async (input: { headers: Headers; asResponse: true }) => {
      calls.push(input.headers)
      return response
    },
  }
}

describe("signOut", () => {
  test("clears the session cookie and returns home", async () => {
    const api = fakeSignOut(
      new Response("{}", { headers: { "Set-Cookie": cleared } }),
    )
    const request = new Request("http://itb.localhost/keluar", {
      method: "POST",
      headers: { cookie: "sb.session_token=abc" },
    })
    const response = await signOut(request, api)
    expect(response.status).toBe(303)
    expect(response.headers.get("Location")).toBe("/")
    expect(response.headers.getSetCookie()).toEqual([cleared])
    expect(api.calls[0]?.get("cookie")).toBe("sb.session_token=abc")
  })

  test("returns to /masuk only, other targets go home", async () => {
    const api = fakeSignOut(
      new Response("{}", { headers: { "Set-Cookie": cleared } }),
    )
    const post = (next: string) =>
      new Request("http://itb.localhost/keluar", {
        method: "POST",
        body: new URLSearchParams({ next }),
      })
    const back = await signOut(post("/masuk"), api)
    expect(back.status).toBe(303)
    expect(back.headers.get("Location")).toBe("/masuk")
    expect(back.headers.getSetCookie()).toEqual([cleared])
    for (const next of ["https://evil.example", "//evil.example", "/lacak"]) {
      const response = await signOut(post(next), api)
      expect(response.headers.get("Location")).toBe("/")
    }
  })

  test("a sign-out is a security event", async () => {
    const api = fakeSignOut(
      new Response("{}", { headers: { "Set-Cookie": cleared } }),
    )
    const lines: Record<string, unknown>[] = []
    const request = new Request("http://itb.localhost/keluar", {
      method: "POST",
    })
    await inRequestScope({ reqId: "r1", userId: "user-1" }, () =>
      signOut(request, api, (line) => lines.push(line)),
    )
    expect(lines).toEqual([
      {
        msg: "security",
        event: "auth_ok",
        host: "itb.localhost",
        path: "/keluar",
        factor: "sign_out",
        user_id: "user-1",
        req_id: "r1",
      },
    ])
  })

  test("still returns home without a session", async () => {
    const api = fakeSignOut(new Response("{}", { status: 400 }))
    const request = new Request("http://itb.localhost/keluar", {
      method: "POST",
    })
    const response = await signOut(request, api)
    expect(response.status).toBe(303)
    expect(response.headers.get("Location")).toBe("/")
  })
})
