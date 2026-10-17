import { connect } from "node:net"

// clamd zINSTREAM, PDF only

export type ClamdConfig = { host: string; port: number; timeoutMs: number }

export type ScanResult =
  | { infected: false }
  | { infected: true; signature: string }

// Starting Values: socket 45 s
const SOCKET_TIMEOUT_MS = 45_000
const CHUNK = 64 * 1024
const FOUND = /^stream: (.+) FOUND$/

export function clamdFromEnv(): ClamdConfig {
  return {
    host: process.env.CLAMD_HOST ?? "127.0.0.1",
    port: Number(process.env.CLAMD_PORT ?? 3310),
    timeoutMs: SOCKET_TIMEOUT_MS,
  }
}

function lengthPrefix(size: number): Buffer {
  const prefix = Buffer.alloc(4)
  prefix.writeUInt32BE(size)
  return prefix
}

/** Throws on any non-verdict reply. */
export function scanBytes(
  bytes: Uint8Array,
  config: ClamdConfig,
  signal?: AbortSignal,
): Promise<ScanResult> {
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    const replies: Buffer[] = []
    const socket = connect(config.port, config.host)
    const fail = (error: Error) => {
      socket.destroy()
      reject(error)
    }
    const onAbort = () => fail(new Error("clamd scan aborted"))
    signal?.addEventListener("abort", onAbort, { once: true })
    socket.setTimeout(config.timeoutMs, () => fail(new Error("clamd timeout")))
    socket.on("error", fail)
    socket.on("connect", () => {
      socket.write("zINSTREAM\0")
      for (let at = 0; at < bytes.byteLength; at += CHUNK) {
        const chunk = bytes.subarray(at, at + CHUNK)
        socket.write(lengthPrefix(chunk.byteLength))
        socket.write(chunk)
      }
      socket.write(lengthPrefix(0))
    })
    socket.on("data", (chunk) => replies.push(Buffer.from(chunk)))
    socket.on("end", () => {
      signal?.removeEventListener("abort", onAbort)
      socket.destroy()
      const reply = Buffer.concat(replies)
        .toString("utf8")
        .replace(/\0$/, "")
        .trim()
      if (reply === "stream: OK") return resolve({ infected: false })
      const found = FOUND.exec(reply)
      if (found?.[1]) return resolve({ infected: true, signature: found[1] })
      reject(new Error(`clamd error: ${reply.slice(0, 120)}`))
    })
  })
}
