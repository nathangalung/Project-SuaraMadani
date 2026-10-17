import { describe, expect, test } from "bun:test"
import { focusById, focusIdAfterRemoval } from "./focus"

function fakeRoot(ids: string[]) {
  const focused: string[] = []
  const root = {
    getElementById: (id: string) =>
      ids.includes(id) ? { focus: () => focused.push(id) } : null,
  } as unknown as Pick<Document, "getElementById">
  return { root, focused }
}

describe("focusById", () => {
  test("focuses the element with that id", () => {
    const { root, focused } = fakeRoot(["signin-code"])
    expect(focusById(root, "signin-code")).toBe(true)
    expect(focused).toEqual(["signin-code"])
  })

  test("reports a missing target", () => {
    const { root, focused } = fakeRoot([])
    expect(focusById(root, "signin-code")).toBe(false)
    expect(focused).toEqual([])
  })
})

describe("focusIdAfterRemoval", () => {
  const removeId = (index: number) => `evidence-remove-${index}`

  test("next button takes the removed one's place", () => {
    expect(focusIdAfterRemoval(0, 3, removeId, "evidence")).toBe(
      "evidence-remove-0",
    )
    expect(focusIdAfterRemoval(1, 3, removeId, "evidence")).toBe(
      "evidence-remove-1",
    )
  })

  test("last item moves focus to the previous button", () => {
    expect(focusIdAfterRemoval(2, 3, removeId, "evidence")).toBe(
      "evidence-remove-1",
    )
  })

  test("empty list falls back to the file input", () => {
    expect(focusIdAfterRemoval(0, 1, removeId, "evidence")).toBe("evidence")
  })
})
