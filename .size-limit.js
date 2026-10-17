import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

// Gzip first-load budgets per route
const BUDGETS = {
  "routes/home": "130 kB",
  "routes/issues/list": "150 kB",
  "routes/issues/detail": "150 kB",
  "routes/issues/unfollow": "150 kB",
  "routes/issues/complaint": "150 kB",
  "routes/demands/list": "150 kB",
  "routes/demands/detail": "150 kB",
  "routes/demands/unfollow": "150 kB",
  "routes/demands/complaint": "150 kB",
  "routes/account/complaint": "150 kB",
  "routes/account/track": "150 kB",
  "routes/data": "150 kB",
  "routes/pages/about": "130 kB",
  "routes/pages/privacy": "130 kB",
  "routes/pages/guidelines": "130 kB",
  "routes/pages/accessibility": "130 kB",
  "routes/not-found": "130 kB",
  "routes/report/relation": "180 kB",
  "routes/report/location": "180 kB",
  "routes/report/details": "180 kB",
  "routes/report/impact": "180 kB",
  "routes/report/evidence": "180 kB",
  "routes/report/contact": "180 kB",
  "routes/report/review": "180 kB",
  "routes/report/success": "180 kB",
  "routes/account/sign-in": "150 kB",
  "routes/account/invitation": "150 kB",
  "routes/manage/two-factor": "150 kB",
  "routes/account/step-up": "150 kB",
  "routes/manage/home": "180 kB",
  "routes/manage/queue": "180 kB",
  "routes/manage/issues": "180 kB",
  "routes/manage/audit": "180 kB",
  "routes/manage/close-account": "180 kB",
  "routes/manage/report": "180 kB",
  "routes/manage/issue": "180 kB",
  "routes/manage/evidence-editor": "180 kB",
  "routes/manage/complaints": "180 kB",
  "routes/manage/demands": "180 kB",
  "routes/manage/demand-new": "180 kB",
  "routes/manage/demand": "180 kB",
  "routes/manage/complaint": "180 kB",
  "routes/manage/members": "180 kB",
  "routes/manage/settings": "180 kB",
  "routes/admin/campuses": "180 kB",
  "routes/admin/whatsapp": "180 kB",
}

const client = join(process.cwd(), "build/client")
const assets = join(client, "assets")
if (!existsSync(assets)) {
  throw new Error("size-limit: run `bun run build` first")
}
const manifestFile = readdirSync(assets).find((f) => f.startsWith("manifest-"))
if (!manifestFile) throw new Error("size-limit: no route manifest")
const manifest = JSON.parse(
  readFileSync(join(assets, manifestFile), "utf8")
    .replace(/^window\.__reactRouterManifest=/, "")
    .replace(/;?\s*$/, ""),
)
const routes = Object.values(manifest.routes)
const byId = new Map(routes.map((r) => [r.id, r]))
const parents = new Set(routes.map((r) => r.parentId))

// First-visit modules per route
function chunks(route) {
  const files = new Set([manifest.entry.module, ...manifest.entry.imports])
  for (let r = route; r; r = byId.get(r.parentId)) {
    files.add(r.module)
    for (const file of r.imports ?? []) files.add(file)
    for (const [key, file] of Object.entries(r)) {
      if (key.endsWith("Module")) files.add(file)
    }
  }
  return [...files].sort().map((file) => {
    const path = join(client, file)
    if (!existsSync(path)) throw new Error(`size-limit: missing ${file}`)
    return path
  })
}

function urlOf(route) {
  const segments = []
  for (let r = route; r; r = byId.get(r.parentId)) {
    if (r.path) segments.unshift(r.path)
  }
  return `/${segments.join("/")}`
}

const leaves = routes.filter((r) => r.hasDefaultExport && !parents.has(r.id))
const unbudgeted = leaves.filter((r) => !(r.id in BUDGETS)).map((r) => r.id)
const stale = Object.keys(BUDGETS).filter(
  (id) => !leaves.some((r) => r.id === id),
)
if (unbudgeted.length > 0 || stale.length > 0) {
  throw new Error(
    `size-limit: no budget for [${unbudgeted}], stale budget [${stale}]`,
  )
}

// No cross-route sum in PLAN
export default leaves.map((route) => ({
  name: urlOf(route),
  path: chunks(route),
  gzip: true,
  limit: BUDGETS[route.id],
}))
