import { CircleCheck, X } from "lucide-react"
import {
  createContext,
  type FocusEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react"
import { focusPageHeading } from "~/components/layout/route-focus"
import { m } from "~/paraglide/messages.js"

export const TOAST_MS = 5000
const MAX_TOASTS = 3

type Clock = {
  now: () => number
  schedule: (run: () => void, ms: number) => () => void
}

const realClock: Clock = {
  now: () => Date.now(),
  schedule: (run, ms) => {
    const id = setTimeout(run, ms)
    return () => clearTimeout(id)
  },
}

/** Pausable timer, keeps remainder. */
export function pausableTimer(
  ms: number,
  onDone: () => void,
  clock: Clock = realClock,
) {
  let remaining = ms
  let startedAt = 0
  let cancel: (() => void) | null = null
  const resume = () => {
    if (cancel) return
    startedAt = clock.now()
    cancel = clock.schedule(onDone, remaining)
  }
  const pause = () => {
    if (!cancel) return
    cancel()
    cancel = null
    remaining = Math.max(0, remaining - (clock.now() - startedAt))
  }
  return { resume, pause, stop: pause }
}

type Opener = Pick<HTMLElement, "isConnected" | "focus">

/** Opener, else the page heading. */
export function restoreFocus(opener: Opener | null, root: ParentNode): void {
  if (opener?.isConnected) opener.focus()
  else focusPageHeading(root)
}

type ToastItem = { id: number; message: string; opener: Opener | null }

const ToastContext = createContext<(message: string) => void>(() => {})

export function useToast() {
  return useContext(ToastContext)
}

// Polite region, always mounted
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const nextId = useRef(0)
  const dismiss = useCallback((id: number) => {
    setItems((list) => list.filter((item) => item.id !== id))
  }, [])
  const show = useCallback((message: string) => {
    nextId.current += 1
    const active = document.activeElement
    const opener = active instanceof HTMLElement ? active : null
    const item = { id: nextId.current, message, opener }
    setItems((list) => [...list.slice(1 - MAX_TOASTS), item])
  }, [])
  return (
    <ToastContext value={show}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-[max(1rem,env(safe-area-inset-bottom))] z-[1500] flex flex-col items-center gap-2 px-4 sm:bottom-8"
      >
        {items.map((item) => (
          <Toast key={item.id} item={item} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext>
  )
}

// Hover or focus pauses
function Toast({
  item,
  onDismiss,
}: {
  item: ToastItem
  onDismiss: (id: number) => void
}) {
  const timer = useRef<ReturnType<typeof pausableTimer>>(null)
  const held = useRef({ hover: false, focus: false })
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const created = pausableTimer(TOAST_MS, () => onDismiss(item.id))
    timer.current = created
    created.resume()
    return created.stop
  }, [item.id, onDismiss])

  const hold = (key: "hover" | "focus", on: boolean) => {
    held.current[key] = on
    const { hover, focus } = held.current
    if (hover || focus) timer.current?.pause()
    else timer.current?.resume()
  }
  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget)) hold("focus", false)
  }
  // Focus never drops to body
  const close = () => {
    const inside = box.current?.contains(document.activeElement) ?? false
    onDismiss(item.id)
    if (inside) restoreFocus(item.opener, document)
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: pauses timer, no action
    <div
      ref={box}
      onMouseEnter={() => hold("hover", true)}
      onMouseLeave={() => hold("hover", false)}
      onFocus={() => hold("focus", true)}
      onBlur={onBlur}
      className="toast-enter pointer-events-auto flex items-center gap-3 rounded-[10px] bg-ink py-3 pr-2 pl-4 text-surface-raised shadow-toast"
    >
      <CircleCheck aria-hidden="true" className="size-5 shrink-0 text-mint" />
      <span className="font-semibold font-ui">{item.message}</span>
      <button
        type="button"
        onClick={close}
        aria-label={m.toast_close()}
        className="grid size-8 place-items-center rounded-md transition-colors hover:bg-surface-raised/10"
      >
        <X aria-hidden="true" className="size-4" />
      </button>
    </div>
  )
}
