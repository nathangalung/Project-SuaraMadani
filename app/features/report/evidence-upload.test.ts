import { describe, expect, test } from "bun:test"
import { type UploadTransport, uploadFiles } from "./evidence-upload"

const file = (name: string) => new File(["abc"], name, { type: "image/png" })

function scripted(statuses: Record<string, number[]>) {
  const calls: string[] = []
  const transport: UploadTransport = async (url, _body, onProgress) => {
    calls.push(url)
    onProgress(1, 2)
    const queue = statuses[url] ?? []
    const status = queue.shift() ?? 201
    if (status === -1) throw new Error("network")
    return status
  }
  return { calls, transport }
}

const noWait = async () => {}

describe("uploadFiles", () => {
  test("sends files one by one in order", async () => {
    const { calls, transport } = scripted({})
    const progress: string[] = []
    const result = await uploadFiles(
      [
        { id: "a", file: file("a.png") },
        { id: "b", file: file("b.png") },
      ],
      {
        transport,
        wait: noWait,
        onProgress: (index, fraction) => progress.push(`${index}:${fraction}`),
      },
    )
    expect(calls).toEqual(["/api/upload/a", "/api/upload/b"])
    expect(result).toEqual({ failed: [] })
    expect(progress).toContain("0:0.5")
    expect(progress).toContain("1:1")
  })

  test("retries network errors and busy answers", async () => {
    const { calls, transport } = scripted({ "/api/upload/a": [-1, 503, 201] })
    const result = await uploadFiles([{ id: "a", file: file("a.png") }], {
      transport,
      wait: noWait,
    })
    expect(calls.length).toBe(3)
    expect(result.failed).toEqual([])
  })

  test("a repeated upload answered 200 counts as sent", async () => {
    const { transport } = scripted({ "/api/upload/a": [200] })
    const result = await uploadFiles([{ id: "a", file: file("a.png") }], {
      transport,
      wait: noWait,
    })
    expect(result.failed).toEqual([])
  })

  test("gives up after three tries and continues", async () => {
    const { calls, transport } = scripted({
      "/api/upload/a": [503, 503, 503, 503],
    })
    const result = await uploadFiles(
      [
        { id: "a", file: file("a.png") },
        { id: "b", file: file("b.png") },
      ],
      { transport, wait: noWait },
    )
    expect(calls.filter((c) => c === "/api/upload/a").length).toBe(3)
    expect(result.failed).toEqual([{ index: 0, status: 503 }])
  })

  test("does not retry refusals", async () => {
    const { calls, transport } = scripted({ "/api/upload/a": [415] })
    const result = await uploadFiles([{ id: "a", file: file("a.png") }], {
      transport,
      wait: noWait,
    })
    expect(calls.length).toBe(1)
    expect(result.failed).toEqual([{ index: 0, status: 415 }])
  })
})
