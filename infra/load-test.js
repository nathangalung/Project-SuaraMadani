// k6 Phase 1 throughput acceptance
// See docs/runbook.md, load test section
import { check, sleep } from "k6"
import exec from "k6/execution"
import http from "k6/http"
import { Counter } from "k6/metrics"

const BASE = __ENV.BASE ?? "http://127.0.0.1:5198"
// Production hosts carry no port
const HOST = __ENV.HOST ?? "itb.localhost"
const ORIGIN = __ENV.ORIGIN ?? `https://${HOST}`
const RATE = Number(__ENV.RATE ?? 30)
const DURATION = __ENV.DURATION ?? "10m"
const SOAK = __ENV.SOAK ?? ""
// One cookie, evidence per client
// Optional ip: CF-Connecting-IP
const UPLOADS = __ENV.UPLOADS ? JSON.parse(open(__ENV.UPLOADS)) : []
const FILE = __ENV.UPLOAD_FILE ? open(__ENV.UPLOAD_FILE, "b") : null
const PAGES = [
  "/",
  "/isu",
  "/data",
  "/tentang",
  "/pedoman",
  "/lacak",
  "/tuntutan",
]
// Below the 120/min API limiter
const API_RATE = Number(__ENV.API_RATE ?? 1)
const API_PAGES = [
  "/api/v1",
  "/api/v1/isu",
  "/api/v1/tuntutan",
  "/api/v1/data",
  "/api/v1/data/wilayah.csv",
]
const MAX_TRIES = 20
// Summed across machines, runbook
const busy = new Counter("upload_busy")

const headers = { Host: HOST }

const scenarios = {
  ssr: {
    executor: "constant-arrival-rate",
    exec: "ssr",
    rate: RATE,
    timeUnit: "1s",
    duration: DURATION,
    preAllocatedVUs: 50,
    maxVUs: 300,
  },
  api: {
    executor: "constant-arrival-rate",
    exec: "api",
    rate: API_RATE,
    timeUnit: "1s",
    duration: DURATION,
    preAllocatedVUs: 5,
    maxVUs: 20,
  },
}
if (UPLOADS.length > 0 && FILE) {
  scenarios.uploads = {
    executor: "per-vu-iterations",
    exec: "upload",
    vus: UPLOADS.length,
    iterations: 1,
    maxDuration: "20m",
  }
}
if (SOAK) {
  scenarios.soak = {
    executor: "constant-arrival-rate",
    exec: "ssr",
    rate: Math.max(1, Math.round(RATE / 3)),
    timeUnit: "1s",
    duration: SOAK,
    startTime: DURATION,
    preAllocatedVUs: 20,
    maxVUs: 100,
  }
}

export const options = {
  scenarios,
  thresholds: {
    // architecture.md Server Budget: p99
    "http_req_duration{scenario:ssr}": ["p(95)<500", "p(99)<1000"],
    "http_req_duration{scenario:api}": ["p(95)<500", "p(99)<1000"],
    "checks{scenario:ssr}": ["rate==1"],
    "checks{scenario:api}": ["rate==1"],
    "checks{scenario:uploads}": ["rate==1"],
  },
}

// Issue pages from the list
export function setup() {
  const list = http.get(`${BASE}/isu`, { headers })
  const codes = [...new Set(String(list.body).match(/ISU-[A-Z]+-\d\d-\d{4}/g))]
  const demands = http.get(`${BASE}/tuntutan`, { headers })
  const tun = [...new Set(String(demands.body).match(/TUN-[A-Z]+-\d\d-\d{4}/g))]
  return {
    pages: [
      ...PAGES,
      ...codes.slice(0, 20).map((c) => `/isu/${c}`),
      ...tun.slice(0, 5).map((c) => `/tuntutan/${c}`),
    ],
    api: [...API_PAGES, ...tun.slice(0, 1).map((c) => `/api/v1/tuntutan/${c}`)],
  }
}

export function ssr(data) {
  const path = data.pages[Math.floor(Math.random() * data.pages.length)]
  // Uncached: no CDN, no cookie
  const res = http.get(`${BASE}${path}`, { headers, tags: { page: path } })
  check(res, { "SSR 200": (r) => r.status === 200 })
}

export function api(data) {
  const path = data.api[Math.floor(Math.random() * data.api.length)]
  const res = http.get(`${BASE}${path}`, { headers, tags: { page: path } })
  check(res, { "API 200": (r) => r.status === 200 })
}

export function upload() {
  // VU ids span every scenario
  const target = UPLOADS[exec.scenario.iterationInTest % UPLOADS.length]
  let status = 0
  for (let i = 0; i < MAX_TRIES && ![200, 201].includes(status); i++) {
    const res = http.post(`${BASE}/api/upload/${target.evidenceId}`, FILE, {
      headers: {
        ...headers,
        // Local run: edge-trusted client IP
        ...(target.ip ? { "CF-Connecting-IP": target.ip } : {}),
        Cookie: target.cookie,
        Origin: ORIGIN,
        "Content-Type": "application/octet-stream",
      },
      timeout: "15m",
    })
    status = res.status
    if (status === 503) {
      // Slots full, client told when
      busy.add(1)
      check(res, {
        "503 has Retry-After": (r) => Number(r.headers["Retry-After"]) > 0,
      })
      sleep(Number(res.headers["Retry-After"]) || 30)
    }
  }
  check(status, { "upload done": (s) => s === 200 || s === 201 })
}
