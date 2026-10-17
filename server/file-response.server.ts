// Video seeking, RFC 9110 ranges
const RANGE = /^bytes=(\d*)-(\d*)$/

export function fileResponse(
  request: Request,
  file: Blob,
  headers: Record<string, string>,
): Response {
  const size = file.size
  const base = { ...headers, "Accept-Ranges": "bytes" }
  const match = RANGE.exec(request.headers.get("range") ?? "")
  if (!match || (match[1] === "" && match[2] === "")) {
    return new Response(file, {
      headers: { ...base, "Content-Length": String(size) },
    })
  }
  let start: number
  let end: number
  if (match[1] === "") {
    start = Math.max(0, size - Number(match[2]))
    end = size - 1
  } else {
    start = Number(match[1])
    end = match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1)
  }
  if (start >= size || start > end) {
    return new Response(null, {
      status: 416,
      headers: { ...base, "Content-Range": `bytes */${size}` },
    })
  }
  return new Response(file.slice(start, end + 1), {
    status: 206,
    headers: {
      ...base,
      "Content-Range": `bytes ${start}-${end}/${size}`,
      "Content-Length": String(end - start + 1),
    },
  })
}
