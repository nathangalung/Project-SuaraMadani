import { createHmac } from "node:crypto"
import { eq, inArray } from "drizzle-orm"
import type { Db } from "../../db/client.server.ts"
import { whatsappAuth } from "../../db/schema/whatsapp.ts"
import { openBytes, sealBytes } from "../../server/seal.ts"

// Baileys parts, injected for tests
export type AuthCodec = {
  replacer: (key: string, value: unknown) => unknown
  reviver: (key: string, value: unknown) => unknown
  initCreds: () => object
  appStateKey: (value: unknown) => unknown
}

export type SealedStore = {
  // Type plain, id keyed
  keyOf: (type: string, id: string) => string
  read: (name: string) => Promise<string | null>
  write: (name: string, json: string) => Promise<void>
  remove: (names: string[]) => Promise<void>
  clear: () => Promise<void>
}

/** whatsapp_auth rows, AES-GCM sealed. */
export function sealedStore(db: Db, key: Buffer): SealedStore {
  // Own subkey, not seal key
  const idKey = createHmac("sha256", key).update("whatsapp_auth id").digest()
  return {
    keyOf: (type, id) =>
      `${type}-${createHmac("sha256", idKey).update(id).digest("hex")}`,
    async read(name) {
      const [row] = await db
        .select({ value: whatsappAuth.value })
        .from(whatsappAuth)
        .where(eq(whatsappAuth.key, name))
        .limit(1)
      if (!row) return null
      try {
        return openBytes(row.value, key, "creds").toString("utf8")
      } catch {
        // Rotated key: relink needed
        return null
      }
    },
    async write(name, json) {
      const value = sealBytes(Buffer.from(json), key, "creds")
      await db
        .insert(whatsappAuth)
        .values({ key: name, value })
        .onConflictDoUpdate({
          target: whatsappAuth.key,
          set: { value, updatedAt: new Date() },
        })
    },
    async remove(names) {
      if (names.length === 0) return
      await db.delete(whatsappAuth).where(inArray(whatsappAuth.key, names))
    },
    async clear() {
      await db.delete(whatsappAuth)
    },
  }
}

type KeyData = Record<string, Record<string, unknown>>

/** Like useMultiFileAuthState, sealed rows. */
export async function authState(store: SealedStore, codec: AuthCodec) {
  const read = async (name: string) => {
    const json = await store.read(name)
    return json === null ? null : (JSON.parse(json, codec.reviver) as unknown)
  }
  const write = (name: string, value: unknown) =>
    store.write(name, JSON.stringify(value, codec.replacer))
  const creds = ((await read("creds")) as object | null) ?? codec.initCreds()
  return {
    state: {
      creds,
      keys: {
        async get(type: string, ids: string[]) {
          const found: Record<string, unknown> = {}
          for (const id of ids) {
            const value = await read(store.keyOf(type, id))
            if (value === null) continue
            found[id] =
              type === "app-state-sync-key" ? codec.appStateKey(value) : value
          }
          return found
        },
        async set(data: KeyData) {
          const gone: string[] = []
          for (const [type, entries] of Object.entries(data)) {
            for (const [id, value] of Object.entries(entries)) {
              const name = store.keyOf(type, id)
              if (value) await write(name, value)
              else gone.push(name)
            }
          }
          await store.remove(gone)
        },
      },
    },
    saveCreds: () => write("creds", creds),
  }
}
