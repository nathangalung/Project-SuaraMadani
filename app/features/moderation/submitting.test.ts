import { describe, expect, test } from "bun:test"
import { isSubmitting } from "./submitting"

function submitting(intent: string | null) {
  const formData = new FormData()
  if (intent) formData.set("intent", intent)
  return { state: "submitting", formData }
}

describe("isSubmitting", () => {
  test("only the submitting form is busy", () => {
    const navigation = submitting("verify")
    expect(isSubmitting(navigation, "verify")).toBe(true)
    expect(isSubmitting(navigation, "merge")).toBe(false)
    expect(isSubmitting(navigation, "start_review")).toBe(false)
  })

  test("forms without an intent follow any submit", () => {
    expect(isSubmitting(submitting(null))).toBe(true)
  })

  test("idle and loading are not busy", () => {
    const idle = { state: "idle" }
    const loading = { state: "loading" }
    expect(isSubmitting(idle)).toBe(false)
    expect(isSubmitting(loading, "verify")).toBe(false)
  })
})
