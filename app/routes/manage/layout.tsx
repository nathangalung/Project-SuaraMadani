import { Outlet } from "react-router"
import { ManageShell } from "~/features/moderation/manage-shell"

// Own shell, no site header
export const handle = { shell: "manage" }

// Children inherit these headers
export function headers() {
  return { "Cache-Control": "private, no-store" }
}

export default function ManageLayout() {
  return (
    <ManageShell>
      <Outlet />
    </ManageShell>
  )
}
