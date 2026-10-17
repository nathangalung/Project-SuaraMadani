import { mkdir, rename, rm, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"

/** Temp file, then rename. */
export async function writeAtomic(
  path: string,
  bytes: Uint8Array,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temp = join(dirname(path), `.tmp-${crypto.randomUUID()}`)
  try {
    await writeFile(temp, bytes)
    await rename(temp, path)
  } finally {
    await rm(temp, { force: true })
  }
}
