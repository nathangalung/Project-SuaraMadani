import { rm } from "node:fs/promises"
import { S3Client } from "bun"
import { writeAtomic } from "../server/atomic-file.server.ts"
import { publicMediaPath } from "../server/files.server.ts"
import type { MediaStore } from "../shared/evidence.ts"

// Public video: R2 in production

export type MediaStoreClient = {
  kind: MediaStore
  putVideo: (host: string, name: string, bytes: Uint8Array) => Promise<void>
  deleteVideo: (host: string, name: string) => Promise<void>
}

type R2Config = {
  endpoint: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
}

/** Tunnel terms bar video. */
export function r2Store(config: R2Config): MediaStoreClient {
  const client = new S3Client(config)
  return {
    kind: "r2",
    putVideo: async (host, name, bytes) => {
      // Validates host and name
      publicMediaPath("/", host, name)
      await client.write(`${host}/${name}`, bytes, { type: "video/mp4" })
    },
    deleteVideo: async (host, name) => {
      publicMediaPath("/", host, name)
      await client.delete(`${host}/${name}`)
    },
  }
}

/** Dev only, app serves it. */
export function localStore(filesDir: () => string): MediaStoreClient {
  return {
    kind: "local",
    putVideo: (host, name, bytes) =>
      writeAtomic(publicMediaPath(filesDir(), host, name), bytes),
    deleteVideo: (host, name) =>
      rm(publicMediaPath(filesDir(), host, name), { force: true }),
  }
}

export function mediaStoreFromEnv(filesDir: string): MediaStoreClient {
  const env = process.env
  if (
    env.MEDIA_R2_ENDPOINT &&
    env.MEDIA_R2_BUCKET &&
    env.MEDIA_R2_ACCESS_KEY_ID &&
    env.MEDIA_R2_SECRET_ACCESS_KEY
  ) {
    return r2Store({
      endpoint: env.MEDIA_R2_ENDPOINT,
      bucket: env.MEDIA_R2_BUCKET,
      accessKeyId: env.MEDIA_R2_ACCESS_KEY_ID,
      secretAccessKey: env.MEDIA_R2_SECRET_ACCESS_KEY,
    })
  }
  if (env.NODE_ENV === "production") {
    throw new Error("MEDIA_R2_* is required in production")
  }
  return localStore(() => filesDir)
}
