// SSR bundle copies these modules

type Store = typeof globalThis & { [key: symbol]: unknown }

/** One value per process. */
export function processGlobal<T>(name: string, create: () => T): T {
  const store = globalThis as Store
  const key = Symbol.for(`sadar-bersuara.${name}`)
  if (!(key in store)) store[key] = create()
  return store[key] as T
}
