import { m } from "~/paraglide/messages.js"

// PLAN §7 life-safety notice
export function EmergencyBanner() {
  return (
    <div className="border-4 border-danger bg-surface-raised p-5">
      <p className="font-semibold text-lg">{m.report_emergency()}</p>
    </div>
  )
}

/** Mounted early for announcements. */
export function EmergencyNotice({ show }: { show: boolean }) {
  return (
    <div role="status">
      {show && (
        <div className="mt-6">
          <EmergencyBanner />
        </div>
      )}
    </div>
  )
}
