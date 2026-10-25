import { type Context, Hono, type MiddlewareHandler } from "hono"
import { cors } from "hono/cors"
import { etag } from "hono/etag"
import { readSnapshotIn } from "../../app/features/data/dashboard.server.ts"
import { PROVINCE_SHAPES } from "../../app/features/data/region-map.server.ts"
import {
  demandsForIssue,
  getDemandPage,
  listPublishedDemands,
  readDemandOverview,
} from "../../app/features/demands/demands.server.ts"
import { normalizeIssueCode } from "../../app/features/issues/issue-code.ts"
import {
  getIssuePage,
  getTakenDown,
  listPublishedIssues,
  readIssueRanking,
} from "../../app/features/issues/issues.server.ts"
import { evidenceViews } from "../../app/features/issues/public-evidence.server.ts"
import { m } from "../../app/paraglide/messages.js"
import {
  getTenantByHost,
  normalizeHost,
  type Tenant,
  withTenant,
} from "../../db/tenant.server.ts"
import {
  DEMAND_LIST_QUERY,
  ISSUE_LIST_QUERY,
  readQuery,
} from "../../shared/canonical-query.ts"
import { MIN_PUBLIC_N, REFRESH_MINUTES } from "../../shared/dashboard.ts"
import { normalizeDemandCode } from "../../shared/demands.ts"
import {
  applyCacheHeaders,
  cachePolicy,
  hasSessionCookie,
} from "../middleware/cache-headers.ts"
import { rateLimit } from "../middleware/rate-limit.ts"
import { apexHost, originFor } from "../origin.server.ts"
import { toCsv } from "./csv.ts"
import {
  DATASET_IDS,
  type Dataset,
  type DatasetId,
  datasets,
  isDatasetId,
} from "./datasets.ts"
import { clientKey } from "./upload.server.ts"

const API_BASE = "/api/v1"
const LICENSE_URL = "https://creativecommons.org/licenses/by/4.0/"
const ALLOW = "GET, HEAD"
// Origin hits only, CDN absorbs
const RATE_LIMIT = { max: 120, windowMs: 60_000 }

export type ApiOptions = {
  cdnTtl: number
  rateLimit?: { max: number; windowMs: number }
  tenantByHost?: (host: string) => Promise<Tenant | undefined>
}

type Env = { Variables: { tenant: Tenant; origin: string } }

export function isPublicApi(path: string): boolean {
  return path === API_BASE || path.startsWith(`${API_BASE}/`)
}

/** Read-only, any origin, no credentials. */
export const apiCors: MiddlewareHandler = cors({
  origin: "*",
  allowMethods: ["GET", "HEAD"],
  exposeHeaders: ["ETag", "Link"],
  maxAge: 86400,
})

function fail(
  c: Context,
  status: 400 | 404 | 405 | 410 | 503,
  error: string,
  extra: Record<string, string> = {},
  headers: Record<string, string> = {},
): Response {
  return c.json({ error, ...extra }, status, {
    "Cache-Control": "no-store",
    ...headers,
  })
}

/** Same rule as public pages. */
function publicCache(cdnTtl: number): MiddlewareHandler {
  return async (c, next) => {
    await next()
    const policy = cachePolicy({
      path: c.req.path,
      method: c.req.method,
      status: c.res.status,
      hasSession: hasSessionCookie(c.req.header("cookie") ?? null),
      setsCookie: c.res.headers.has("Set-Cookie"),
      routeSet: false,
    })
    applyCacheHeaders(c.res.headers, policy, cdnTtl)
  }
}

function originOf(c: Context<Env>): string {
  return c.get("origin")
}

function meta(c: Context<Env>, path: string) {
  const tenant = c.get("tenant")
  const source = `${originOf(c)}${path}`
  return {
    license: "CC-BY-4.0",
    licenseUrl: LICENSE_URL,
    attribution: m.api_attribution({
      operator: tenant.name,
      campus: tenant.campusName,
      url: source,
    }),
    source,
  }
}

function link(c: Context<Env>, html: string, extra: string[] = []): void {
  c.header(
    "Link",
    [
      `<${LICENSE_URL}>; rel="license"`,
      `<${originOf(c)}${html}>; rel="alternate"; type="text/html"`,
      ...extra,
    ].join(", "),
  )
}

/** Absolute media and brief URLs. */
function absolute(c: Context<Env>, url: string): string {
  return url.startsWith("/") ? `${originOf(c)}${url}` : url
}

const DATASET_TITLES: Record<DatasetId, () => string> = {
  ringkasan: m.data_key_title,
  tren: m.api_dataset_trend,
  kategori: m.data_category_title,
  status: m.data_status_title,
  penyelesaian: m.api_dataset_resolution,
  tanggapan: m.data_response_title,
  "umur-tunggu": m.api_dataset_waiting,
  "lewat-tenggat": m.api_dataset_overdue,
  wilayah: m.api_dataset_regions,
  "wilayah-total": m.api_dataset_region_totals,
  "peringkat-isu": m.data_ranking_title,
  tuntutan: m.api_dataset_demands,
  "tuntutan-wilayah": m.api_dataset_demand_regions,
}

type DashboardData = {
  stored: NonNullable<Awaited<ReturnType<typeof readSnapshotIn>>>
  tables: Record<DatasetId, Dataset>
}

/** Snapshot and live reads, together. */
function readData(orgId: string): Promise<DashboardData | null> {
  const now = new Date()
  // PERF-04: one pooled connection
  return withTenant(orgId, async (tx) => {
    const stored = await readSnapshotIn(tx, now)
    if (!stored) return null
    const overview = await readDemandOverview(tx)
    const tables = datasets({
      snapshot: stored.data,
      provinces: PROVINCE_SHAPES.map(({ code, name }) => ({ code, name })),
      demands: { counts: overview.counts, provinces: overview.provinces },
      ranking: {
        laporan: await readIssueRanking(tx, "laporan", now),
        terlama: await readIssueRanking(tx, "terlama", now),
      },
    })
    return { stored, tables }
  })
}

/** Canonical order, no 301. */
/** Next numbered page, or null. */
function nextUrl(
  c: Context<Env>,
  path: string,
  query: Record<string, string | undefined>,
  result: { page: number; pageCount: number },
): string | null {
  if (result.page >= result.pageCount) return null
  const entries = Object.entries({ ...query, halaman: String(result.page + 1) })
    .filter((entry): entry is [string, string] => Boolean(entry[1]))
    .sort(([a], [b]) => (a < b ? -1 : 1))
  return `${originOf(c)}${API_BASE}${path}?${new URLSearchParams(entries)}`
}

function pending(c: Context): Response {
  return fail(
    c,
    503,
    "snapshot_pending",
    {},
    {
      "Retry-After": String(REFRESH_MINUTES * 60),
    },
  )
}

/** Public data API, item 4. */
export function publicDataApi(options: ApiOptions): Hono<Env> {
  const api = new Hono<Env>()
  const tenantByHost = options.tenantByHost ?? getTenantByHost
  const limits = options.rateLimit ?? RATE_LIMIT

  api.use(async (c, next) => {
    if (c.req.method === "GET" || c.req.method === "HEAD") return next()
    return fail(c, 405, "method_not_allowed", {}, { Allow: ALLOW })
  })
  api.use(
    rateLimit({
      ...limits,
      key: (c) => clientKey(c.req.header("x-client-ip") ?? null),
    }),
  )
  api.use(async (c, next) => {
    const url = new URL(c.req.url)
    const host = normalizeHost(url.host)
    // Apex shows aggregates only
    const tenant =
      host === apexHost() ? undefined : await tenantByHost(url.host)
    if (!tenant) return fail(c, 404, "not_found")
    c.set("tenant", tenant)
    // Same origin as page URLs
    c.set("origin", originFor(tenant.host))
    return next()
  })
  api.use(etag({ weak: true }))
  api.use(publicCache(options.cdnTtl))

  api.get("/", (c) => {
    link(c, "/data")
    const origin = `${originOf(c)}${API_BASE}`
    return c.json({
      meta: meta(c, "/data"),
      endpoints: {
        issues: `${origin}/isu`,
        issue: `${origin}/isu/{code}`,
        demands: `${origin}/tuntutan`,
        demand: `${origin}/tuntutan/{code}`,
        data: `${origin}/data`,
        dataset: `${origin}/data/{dataset}.csv`,
      },
    })
  })

  api.get("/isu", async (c) => {
    const query = readQuery(new URL(c.req.url).searchParams, ISSUE_LIST_QUERY)
    const result = await listPublishedIssues(c.get("tenant").id, query)
    if (result.kind === "busy") {
      return fail(c, 503, "busy", {}, { "Retry-After": "5" })
    }
    if (result.kind !== "results") return fail(c, 400, result.kind)
    link(c, "/isu")
    return c.json({
      meta: meta(c, "/isu"),
      issues: result.issues.map((issue) => ({
        code: issue.code,
        title: issue.title,
        excerpt: issue.excerpt,
        categoryId: issue.categoryId,
        subcategoryId: issue.subcategoryId,
        regencyName: issue.regencyName,
        districtName: issue.districtName,
        advocacyStatus: issue.advocacyStatus,
        govStatus: issue.govStatus,
        verificationLabel: issue.verificationLabel,
        reportCount: issue.reportCount,
        publishedAt: issue.publishedAt,
        lastActivityAt: issue.lastActivityAt,
        url: `${originOf(c)}/isu/${issue.code}`,
        api: `${originOf(c)}${API_BASE}/isu/${issue.code}`,
      })),
      next: nextUrl(c, "/isu", query, result),
    })
  })

  api.get("/isu/:code", async (c) => {
    const param = c.req.param("code")
    const code = normalizeIssueCode(param)
    if (!code) return fail(c, 404, "not_found")
    if (code !== param) return c.redirect(`${API_BASE}/isu/${code}`, 301)
    const tenant = c.get("tenant")
    const page = await getIssuePage(tenant.id, code)
    if (!page) {
      const gone = await getTakenDown(tenant.id, code)
      return gone
        ? fail(c, 410, "taken_down", {
            takenDownAt: gone.takenDownAt.toISOString(),
            reason: gone.reason,
          })
        : fail(c, 404, "not_found")
    }
    const demands = await demandsForIssue(tenant.id, code)
    link(c, `/isu/${code}`)
    return c.json({
      meta: meta(c, `/isu/${code}`),
      issue: {
        code: page.code,
        title: page.title,
        summary: page.summary,
        categoryId: page.categoryId,
        subcategoryId: page.subcategoryId,
        provinceName: page.provinceName,
        regencyName: page.regencyName,
        districtName: page.districtName,
        advocacyStatus: page.advocacyStatus,
        govStatus: page.govStatus,
        verificationLabel: page.verificationLabel,
        reportCount: page.reportCount,
        publishedAt: page.publishedAt,
        lastActivityAt: page.lastActivityAt,
        version: page.version,
        redactedAt: page.redactedAt,
        redactionReason: page.redactionReason,
        referrals: page.record.referrals,
        responses: page.record.responses,
        events: page.record.events,
        evidence: evidenceViews(page.evidence, tenant.host).map((item) => ({
          ...item,
          media: item.media.map((one) =>
            one.type === "video"
              ? {
                  ...one,
                  src: absolute(c, one.src),
                  poster: absolute(c, one.poster),
                }
              : { ...one, src: absolute(c, one.src) },
          ),
        })),
        demands: demands.map((demand) => ({
          code: demand.code,
          title: demand.title,
          url: `${originOf(c)}/tuntutan/${demand.code}`,
        })),
        url: `${originOf(c)}/isu/${code}`,
      },
    })
  })

  api.get("/tuntutan", async (c) => {
    const query = readQuery(new URL(c.req.url).searchParams, DEMAND_LIST_QUERY)
    const result = await listPublishedDemands(c.get("tenant").id, query)
    if (result.kind !== "results") return fail(c, 400, result.kind)
    link(c, "/tuntutan")
    return c.json({
      meta: meta(c, "/tuntutan"),
      demands: result.demands.map((demand) => ({
        code: demand.code,
        title: demand.title,
        summary: demand.summary,
        scope: demand.scope,
        category: demand.category,
        provinceName: demand.provinceName,
        regencyName: demand.regencyName,
        target: demand.target,
        raisedOn: demand.raisedOn,
        state: demand.state,
        publishedAt: demand.publishedAt,
        progress: demand.progress,
        rank: demand.rank,
        briefs: demand.briefs,
        issueCount: demand.issueCount,
        url: `${originOf(c)}/tuntutan/${demand.code}`,
        api: `${originOf(c)}${API_BASE}/tuntutan/${demand.code}`,
      })),
      next: nextUrl(c, "/tuntutan", query, result),
    })
  })

  api.get("/tuntutan/:code", async (c) => {
    const param = c.req.param("code")
    const code = normalizeDemandCode(param)
    if (!code) return fail(c, 404, "not_found")
    if (code !== param) return c.redirect(`${API_BASE}/tuntutan/${code}`, 301)
    const page = await getDemandPage(c.get("tenant").id, code)
    // Drafts and hidden: 404
    if (!page) return fail(c, 404, "not_found")
    link(c, `/tuntutan/${code}`)
    return c.json({
      meta: meta(c, `/tuntutan/${code}`),
      demand: {
        code: page.code,
        title: page.title,
        summary: page.summary,
        body: page.body,
        scope: page.scope,
        category: page.category,
        provinceName: page.provinceName,
        regencyName: page.regencyName,
        target: page.target,
        raisedOn: page.raisedOn,
        briefUrl: page.briefUrl,
        state: page.state,
        publishedAt: page.publishedAt,
        closedAt: page.closedAt,
        version: page.version,
        progress: page.progress,
        rank: page.rank,
        ranking: page.ranking,
        items: page.items.map((item) => ({
          number: item.number,
          body: item.body,
          response: item.response,
          fulfilment: item.fulfilment,
          briefSummary: item.briefSummary,
          briefUrl: item.briefUrl,
          brief: item.brief
            ? {
                byteSize: item.brief.byteSize,
                url: absolute(c, item.brief.url),
              }
            : null,
        })),
        events: page.events.map((event) => ({
          action: event.action,
          item: event.item,
          response: event.response,
          fulfilment: event.fulfilment,
          occurredOn: event.occurredOn,
          note: event.note,
          sourceText: event.sourceText,
          sourceUrl: event.sourceUrl,
        })),
        issues: page.issues.map((issue) => ({
          code: issue.code,
          title: issue.title,
          url: `${originOf(c)}/isu/${issue.code}`,
        })),
        url: `${originOf(c)}/tuntutan/${code}`,
      },
    })
  })

  api.get("/data", async (c) => {
    const found = await readData(c.get("tenant").id)
    if (!found) return pending(c)
    const { stored, tables } = found
    link(c, "/data")
    const base = `${originOf(c)}${API_BASE}/data`
    return c.json({
      meta: {
        ...meta(c, "/data"),
        computedAt: stored.computedAt,
        nextAt: stored.nextAt,
        stale: stored.stale,
        firstReportAt: stored.data.firstReportAt,
        suppression: { minPublicN: MIN_PUBLIC_N },
        readme: `${base}/README.txt`,
        datasets: DATASET_IDS.map((id) => ({
          id,
          title: DATASET_TITLES[id](),
          columns: tables[id].columns,
          csv: `${base}/${id}.csv`,
        })),
      },
      datasets: Object.fromEntries(
        DATASET_IDS.map((id) => [id, tables[id].rows]),
      ),
    })
  })

  // CMP-23: licence travels with files
  const readme = async (c: Context<Env>) => {
    const found = await readData(c.get("tenant").id)
    if (!found) return pending(c)
    const tenant = c.get("tenant")
    const base = `${originOf(c)}${API_BASE}/data`
    link(c, "/data", [`<${base}>; rel="describedby"`])
    const lines = [
      m.api_readme_title({
        operator: tenant.name,
        campus: tenant.campusName,
      }),
      "",
      m.api_readme_license({ url: LICENSE_URL }),
      m.api_readme_attribution({ text: meta(c, "/data").attribution }),
      m.api_readme_computed({
        at: found.stored.computedAt,
      }),
      m.api_readme_suppression({ n: MIN_PUBLIC_N }),
      m.api_readme_metadata({ url: base }),
      "",
      m.api_readme_tables(),
      ...DATASET_IDS.map(
        (id) =>
          `- ${base}/${id}.csv: ${DATASET_TITLES[id]()} (${found.tables[id].columns.join(", ")})`,
      ),
    ]
    return c.body(`${lines.join("\r\n")}\r\n`, 200, {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${tenant.slug}-README.txt"`,
    })
  }

  // One param route: RegExpRouter stays
  api.get("/data/:file", async (c) => {
    if (c.req.param("file") === "README.txt") return readme(c)
    const id = c.req.param("file").replace(/\.csv$/, "")
    if (!c.req.param("file").endsWith(".csv") || !isDatasetId(id)) {
      return fail(c, 404, "not_found")
    }
    const found = await readData(c.get("tenant").id)
    if (!found) return pending(c)
    const table = found.tables[id]
    link(c, "/data", [
      `<${originOf(c)}${API_BASE}/data>; rel="describedby"`,
      `<${originOf(c)}${API_BASE}/data/README.txt>; rel="help"`,
    ])
    return c.body(toCsv(table.columns, table.rows), 200, {
      "Content-Type": "text/csv; charset=utf-8; header=present",
      "Content-Disposition": `attachment; filename="${c.get("tenant").slug}-${id}.csv"`,
    })
  })

  api.all("*", (c) => fail(c, 404, "not_found"))
  return api
}
