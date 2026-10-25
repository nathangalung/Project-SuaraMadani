import { describe, expect, test } from "bun:test"
import { newestCopy, newestUpload } from "./b2-newest.ts"

describe("newestUpload", () => {
  test("latest upload wins, folders ignored", () => {
    expect(
      newestUpload(
        [
          { action: "upload", uploadTimestamp: 1_000 },
          { action: "folder", uploadTimestamp: 0 },
          { action: "hide", uploadTimestamp: 9_000 },
          { action: "upload", uploadTimestamp: 5_000 },
        ],
        2_000,
      ),
    ).toBe(5_000)
  })

  test("keeps the earlier maximum", () => {
    expect(newestUpload([{ action: "upload", uploadTimestamp: 1 }], 7)).toBe(7)
  })
})

const ENV = {
  B2_LIST_KEY_ID: "kunci-id",
  B2_LIST_KEY: "rahasia",
  B2_BUCKET: "sb-evidence-copy",
}
const API_URL = "https://api005.backblazeb2.com"
const NEWEST = Date.UTC(2026, 9, 20, 3, 0)

type Call = { url: URL; authorization: string }

/** Fake B2: auth, two pages. */
function fakeB2(
  options: {
    buckets?: { id: string; name: string | null }[]
    pages?: { files: { action: string; uploadTimestamp: number }[] }[]
    status?: number
  } = {},
) {
  const calls: Call[] = []
  const pages = options.pages ?? [
    { files: [{ action: "upload", uploadTimestamp: NEWEST - 60_000 }] },
    {
      files: [
        { action: "upload", uploadTimestamp: NEWEST },
        { action: "hide", uploadTimestamp: NEWEST + 60_000 },
      ],
    },
  ]
  const fetcher = async (input: string, init: RequestInit) => {
    const url = new URL(input)
    const authorization = new Headers(init.headers).get("authorization") ?? ""
    calls.push({ url, authorization })
    if (options.status) return new Response("{}", { status: options.status })
    if (url.pathname.endsWith("/b2_authorize_account")) {
      return Response.json({
        authorizationToken: "token-b2",
        apiInfo: {
          storageApi: {
            apiUrl: API_URL,
            allowed: {
              buckets: options.buckets ?? [
                { id: "bucket-1", name: ENV.B2_BUCKET },
              ],
            },
          },
        },
      })
    }
    const start = url.searchParams.get("startFileName")
    const at = start ? Number(start) : 0
    const next = at + 1 < pages.length ? String(at + 1) : null
    return Response.json({ ...pages[at], nextFileName: next })
  }
  return { calls, fetcher }
}

describe("newestCopy", () => {
  test("Given a list-only key, when the copy spans two pages, then it prints the newest upload time", async () => {
    const { calls, fetcher } = fakeB2()
    expect(await newestCopy(ENV, fetcher)).toBe(new Date(NEWEST).toISOString())
    expect(calls[0]?.authorization).toBe(`Basic ${btoa("kunci-id:rahasia")}`)
    const lists = calls.slice(1)
    expect(lists.map((call) => call.url.origin)).toEqual([API_URL, API_URL])
    expect(lists.map((call) => call.authorization)).toEqual([
      "token-b2",
      "token-b2",
    ])
    expect(lists.map((call) => call.url.searchParams.get("bucketId"))).toEqual([
      "bucket-1",
      "bucket-1",
    ])
    expect(
      lists.map((call) => call.url.searchParams.get("startFileName")),
    ).toEqual([null, "1"])
  })

  test("Given a key not limited to the bucket, then it refuses to list", async () => {
    const { calls, fetcher } = fakeB2({
      buckets: [{ id: "bucket-2", name: "lain" }],
    })
    await expect(newestCopy(ENV, fetcher)).rejects.toThrow(
      "key is not limited to B2_BUCKET",
    )
    expect(calls).toHaveLength(1)
  })

  test("Given an empty copy, then it fails rather than report an age", async () => {
    const { fetcher } = fakeB2({ pages: [{ files: [] }] })
    await expect(newestCopy(ENV, fetcher)).rejects.toThrow("B2 copy is empty")
  })

  test("Given B2 refuses the key, then the error names the call and status", async () => {
    const { fetcher } = fakeB2({ status: 401 })
    await expect(newestCopy(ENV, fetcher)).rejects.toThrow(
      "B2 /b2api/v4/b2_authorize_account 401",
    )
  })

  test("Given a missing variable, then it fails before any request", async () => {
    const { calls, fetcher } = fakeB2()
    const { B2_LIST_KEY: _, ...partial } = ENV
    await expect(newestCopy(partial, fetcher)).rejects.toThrow(
      "B2_LIST_KEY is not set",
    )
    expect(calls).toEqual([])
  })
})
