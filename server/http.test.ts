import { describe, expect, test } from "bun:test"
import { boundedJson, withDeadline } from "./http.ts"

describe("boundedJson", () => {
  test("reads small JSON, refuses large or broken", async () => {
    expect(await boundedJson(Response.json({ a: 1 }), 64)).toEqual({ a: 1 })
    // API10: no unbounded buffering
    expect(await boundedJson(new Response("x".repeat(100)), 64)).toBeNull()
    const declared = new Response("{}", { headers: { "content-length": "99" } })
    expect(await boundedJson(declared, 64)).toBeNull()
    expect(await boundedJson(new Response("{"), 64)).toBeNull()
  })

  test("Given an oversized body whose cancel fails, then it still answers null", async () => {
    const stuck = () =>
      new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(new TextEncoder().encode("x".repeat(100)))
        },
        cancel() {
          throw new Error("socket gone")
        },
      })
    const declared = new Response(stuck(), {
      headers: { "content-length": "99" },
    })
    expect(await boundedJson(declared, 64)).toBeNull()
    expect(await boundedJson(new Response(stuck()), 64)).toBeNull()
  })
})

describe("withDeadline", () => {
  test("Given a call that never answers, when the deadline passes, then it rejects", async () => {
    const never = new Promise<string>(() => {})
    await expect(withDeadline(never, 10)).rejects.toThrow("deadline exceeded")
  })

  test("Given a call that answers in time, then its value is returned", async () => {
    expect(await withDeadline(Promise.resolve("ok"), 1000)).toBe("ok")
  })
})
