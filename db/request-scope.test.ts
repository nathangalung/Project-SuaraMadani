import { describe, expect, test } from "bun:test"
import { inRequestScope, requestScope } from "./request-scope.ts"

describe("request scope", () => {
  test("visible across awaits, gone outside", async () => {
    expect(requestScope()).toBeUndefined()
    const seen = await inRequestScope({ reqId: "r1" }, async () => {
      await Promise.resolve()
      const scope = requestScope()
      if (scope) scope.userId = "u1"
      return requestScope()
    })
    expect(seen).toEqual({ reqId: "r1", userId: "u1" })
    expect(requestScope()).toBeUndefined()
  })
})
