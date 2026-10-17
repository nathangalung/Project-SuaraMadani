import { describe, expect, test } from "bun:test"
import { createSlots } from "./slots.ts"

describe("createSlots", () => {
  test("tryRun refuses when every slot is busy", async () => {
    const slots = createSlots(2)
    let release = () => {}
    const blocked = new Promise<void>((resolve) => {
      release = resolve
    })
    const a = slots.tryRun(() => blocked)
    const b = slots.tryRun(() => blocked)
    expect(await slots.tryRun(async () => "third")).toEqual({ ran: false })
    release()
    await Promise.all([a, b])
    expect(await slots.tryRun(async () => "after")).toEqual({
      ran: true,
      value: "after",
    })
  })

  test("run waits for a free slot in order", async () => {
    const slots = createSlots(1)
    const order: string[] = []
    let release = () => {}
    const first = slots.run(
      () =>
        new Promise<void>((resolve) => {
          order.push("first")
          release = resolve
        }),
    )
    const second = slots.run(async () => {
      order.push("second")
    })
    await Promise.resolve()
    expect(order).toEqual(["first"])
    release()
    await Promise.all([first, second])
    expect(order).toEqual(["first", "second"])
  })

  test("a throwing task frees its slot", async () => {
    const slots = createSlots(1)
    await expect(
      slots.run(async () => {
        throw new Error("boom")
      }),
    ).rejects.toThrow("boom")
    expect(await slots.tryRun(async () => 1)).toEqual({ ran: true, value: 1 })
  })
})
