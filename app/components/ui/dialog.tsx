import { type ReactNode, useEffect, useId, useRef } from "react"
import { cn } from "./cn"

type BackdropEvent = {
  target: unknown
  currentTarget: { close: () => void }
}

/** Backdrop click acts like cancel. */
export function backdropClose(enabled: boolean) {
  // Inner padding: target means backdrop
  return (event: BackdropEvent) => {
    if (enabled && event.target === event.currentTarget) {
      event.currentTarget.close()
    }
  }
}

type DialogProps = {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  actions?: ReactNode
  // Only dialogs without inputs
  closeOnBackdrop?: boolean
  className?: string
}

// Native modal: focus trap, Esc
export function Dialog({
  open,
  onClose,
  title,
  children,
  actions,
  closeOnBackdrop = false,
  className,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Esc closes natively
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={backdropClose(closeOnBackdrop)}
      className={cn(
        "dialog-enter m-auto w-[calc(100%-2rem)] max-w-lg rounded-xl bg-surface-raised p-0 text-ink shadow-floating backdrop:bg-ink/40 backdrop:backdrop-blur-[2px]",
        className,
      )}
    >
      <div className="p-6 sm:p-8">
        <h2 id={titleId} className="font-heading text-2xl">
          {title}
        </h2>
        <div className="mt-3 text-ink-soft leading-relaxed">{children}</div>
        {actions && (
          <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            {actions}
          </div>
        )}
      </div>
    </dialog>
  )
}
