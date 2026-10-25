import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { publicMediaPath } from "../server/files.server.ts"
import { mediaStoreFromEnv } from "./media-store.ts"

const KEYS = [
  "MEDIA_R2_ENDPOINT",
  "MEDIA_R2_BUCKET",
  "MEDIA_R2_ACCESS_KEY_ID",
  "MEDIA_R2_SECRET_ACCESS_KEY",
] as const
const saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]))
const savedNodeEnv = process.env.NODE_ENV

function setR2(endpoint: string): void {
  process.env.MEDIA_R2_ENDPOINT = endpoint
  process.env.MEDIA_R2_BUCKET = "media"
  process.env.MEDIA_R2_ACCESS_KEY_ID = "id"
  process.env.MEDIA_R2_SECRET_ACCESS_KEY = "secret"
}

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
  process.env.NODE_ENV = savedNodeEnv
})

function clearR2(): void {
  for (const key of KEYS) delete process.env[key]
}

describe("mediaStoreFromEnv", () => {
  test("an https endpoint gives R2", () => {
    setR2("https://abc.r2.cloudflarestorage.com")
    expect(mediaStoreFromEnv("/tmp").kind).toBe("r2")
  })

  test("a plaintext endpoint refuses to start", () => {
    // ASVS V12.3.1: never plaintext
    setR2("http://abc.r2.cloudflarestorage.com")
    expect(() => mediaStoreFromEnv("/tmp")).toThrow("https")
    setR2("abc.r2.cloudflarestorage.com")
    expect(() => mediaStoreFromEnv("/tmp")).toThrow("https")
  })
})

describe("without R2 keys", () => {
  test("Given production, when the store is built, then the worker refuses to start", () => {
    clearR2()
    process.env.NODE_ENV = "production"
    expect(() => mediaStoreFromEnv("/tmp")).toThrow("MEDIA_R2_*")
  })

  test("Given development, when a video is stored and deleted, then it lives under the files dir", async () => {
    clearR2()
    const dir = await mkdtemp(`${tmpdir()}/media-store-`)
    try {
      const store = mediaStoreFromEnv(dir)
      const name = `${"d".repeat(64)}.mp4`
      const path = publicMediaPath(dir, "km.localhost", name)
      await store.putVideo("km.localhost", name, new Uint8Array([1, 2]))
      expect(Array.from(await Bun.file(path).bytes())).toEqual([1, 2])
      await store.deleteVideo("km.localhost", name)
      expect(await Bun.file(path).exists()).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
