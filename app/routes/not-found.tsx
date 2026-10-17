import { data } from "react-router"

// Root shell renders the 404
export function loader() {
  throw data(null, { status: 404 })
}

// Document route, not resource
export default function NotFound() {
  return null
}
