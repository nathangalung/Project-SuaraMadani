import { getAuth } from "../../../server/auth.server.ts"
import type { Route } from "./+types/auth"

export async function loader({ request }: Route.LoaderArgs) {
  return (await getAuth()).handler(request)
}

export async function action({ request }: Route.ActionArgs) {
  return (await getAuth()).handler(request)
}
