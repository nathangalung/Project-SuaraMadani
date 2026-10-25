// Newest upload in B2 copy
// Env: B2_LIST_KEY_ID, B2_LIST_KEY, B2_BUCKET

type B2File = { action: string; uploadTimestamp: number }
type Allowed = { buckets?: { id: string; name: string | null }[] }
type Auth = {
  authorizationToken: string
  apiInfo: { storageApi: { apiUrl: string; allowed: Allowed } }
}
type Page = { files: B2File[]; nextFileName: string | null }

const API = "https://api.backblazeb2.com/b2api/v4"
const TIMEOUT_MS = 15_000

/** Max upload time, uploads only. */
export function newestUpload(files: B2File[], start: number): number {
  return files.reduce(
    (max, file) =>
      file.action === "upload" ? Math.max(max, file.uploadTimestamp) : max,
    start,
  )
}

type Env = Record<string, string | undefined>
type Fetch = (url: string, init: RequestInit) => Promise<Response>

function required(env: Env, name: string): string {
  const value = env[name]
  if (!value) throw new Error(`${name} is not set`)
  return value
}

async function getJson<T>(
  fetcher: Fetch,
  url: string,
  authorization: string,
): Promise<T> {
  const res = await fetcher(url, {
    headers: { authorization },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`B2 ${new URL(url).pathname} ${res.status}`)
  return (await res.json()) as T
}

/** Newest upload, ISO time. */
export async function newestCopy(
  env: Env = process.env,
  fetcher: Fetch = fetch,
): Promise<string> {
  const id = required(env, "B2_LIST_KEY_ID")
  const basic = btoa(`${id}:${required(env, "B2_LIST_KEY")}`)
  const bucketName = required(env, "B2_BUCKET")
  const auth = await getJson<Auth>(
    fetcher,
    `${API}/b2_authorize_account`,
    `Basic ${basic}`,
  )
  const bucket = auth.apiInfo.storageApi.allowed.buckets?.find(
    (b) => b.name === bucketName,
  )
  if (!bucket) throw new Error("key is not limited to B2_BUCKET")
  let newest = 0
  let start: string | null = ""
  while (start !== null) {
    const query = new URLSearchParams({
      bucketId: bucket.id,
      maxFileCount: "1000",
      ...(start ? { startFileName: start } : {}),
    })
    const page: Page = await getJson<Page>(
      fetcher,
      `${auth.apiInfo.storageApi.apiUrl}/b2api/v4/b2_list_file_names?${query}`,
      auth.authorizationToken,
    )
    newest = newestUpload(page.files, newest)
    start = page.nextFileName
  }
  if (newest === 0) throw new Error("B2 copy is empty")
  return new Date(newest).toISOString()
}

if (import.meta.main) console.log(await newestCopy())
