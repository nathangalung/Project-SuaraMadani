export type Slots = {
  /** Waits for a free slot. */
  run<T>(task: () => Promise<T>): Promise<T>
  /** Refuses when slots are full. */
  tryRun<T>(
    task: () => Promise<T>,
  ): Promise<{ ran: true; value: T } | { ran: false }>
}

// Per-process cap on expensive work
export function createSlots(size: number): Slots {
  let busy = 0
  const waiting: (() => void)[] = []

  function release() {
    const next = waiting.shift()
    if (next) next()
    else busy--
  }

  async function execute<T>(task: () => Promise<T>): Promise<T> {
    try {
      return await task()
    } finally {
      release()
    }
  }

  return {
    async run(task) {
      if (busy < size) busy++
      // Slot handed over by release
      else await new Promise<void>((resolve) => waiting.push(resolve))
      return execute(task)
    },
    async tryRun(task) {
      if (busy >= size) return { ran: false }
      busy++
      return { ran: true, value: await execute(task) }
    },
  }
}
