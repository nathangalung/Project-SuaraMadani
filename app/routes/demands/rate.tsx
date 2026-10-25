import { redirect } from "react-router"

// Ranking replaced the 1-5 score
export function loader() {
  throw redirect("/tuntutan/peringkat", 301)
}
