// One authenticated request per file

/** Resolves status, throws when offline. */
export type UploadTransport = (
  url: string,
  body: Blob,
  onProgress: (loaded: number, total: number) => void,
) => Promise<number>

export type UploadItem = { id: string; file: Blob }
export type UploadFailure = { index: number; status: number }

type UploadOptions = {
  transport?: UploadTransport
  wait?: (ms: number) => Promise<void>
  onProgress?: (index: number, fraction: number) => void
}

const MAX_TRIES = 3
const RETRY_STATUSES = new Set([0, 408, 429, 500, 502, 503, 504])

const xhrTransport: UploadTransport = (url, body, onProgress) =>
  new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open("POST", url)
    xhr.setRequestHeader(
      "Content-Type",
      body.type || "application/octet-stream",
    )
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded, event.total)
    }
    xhr.onload = () => resolve(xhr.status)
    xhr.onerror = () => reject(new Error("network"))
    xhr.ontimeout = () => reject(new Error("timeout"))
    xhr.send(body)
  })

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms))

async function sendOne(
  item: UploadItem,
  index: number,
  options: Required<UploadOptions>,
): Promise<number> {
  let status = 0
  for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
    try {
      status = await options.transport(
        `/api/upload/${encodeURIComponent(item.id)}`,
        item.file,
        (loaded, total) =>
          options.onProgress(index, total ? loaded / total : 0),
      )
    } catch {
      status = 0
    }
    if (status === 200 || status === 201) {
      options.onProgress(index, 1)
      return status
    }
    if (!RETRY_STATUSES.has(status) || attempt === MAX_TRIES) return status
    await options.wait(2000 * attempt)
  }
  return status
}

/** Sequential, so slots stay free. */
export async function uploadFiles(
  items: UploadItem[],
  options: UploadOptions = {},
): Promise<{ failed: UploadFailure[] }> {
  const resolved: Required<UploadOptions> = {
    transport: options.transport ?? xhrTransport,
    wait: options.wait ?? sleep,
    onProgress: options.onProgress ?? (() => {}),
  }
  const failed: UploadFailure[] = []
  for (const [index, item] of items.entries()) {
    const status = await sendOne(item, index, resolved)
    if (status !== 200 && status !== 201) failed.push({ index, status })
  }
  return { failed }
}
