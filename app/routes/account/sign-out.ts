import { redirect } from "react-router"
import { signOut } from "~/features/report/sign-out.server"
import type { Route } from "./+types/sign-out"

export function loader() {
  return redirect("/")
}

export function action({ request }: Route.ActionArgs) {
  return signOut(request)
}
