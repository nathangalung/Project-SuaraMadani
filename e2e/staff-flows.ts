// Bun: admin flows, HTTP
import type { Pool } from "pg"
import { CONSENT_TEXT_VERSION } from "../shared/report-fields.ts"
import { actionData, CAPTCHA_PASS, type FullApp } from "./app-harness.ts"

export type Fields = Record<string, string | string[]>

/** Browser-style form POST. */
export function postForm(
  app: FullApp,
  url: string,
  cookie: string,
  fields: Fields,
): Promise<Response> {
  const body = new URLSearchParams()
  for (const [key, value] of Object.entries(fields)) {
    for (const one of Array.isArray(value) ? value : [value]) {
      body.append(key, one)
    }
  }
  return app.request(url, {
    method: "POST",
    headers: {
      cookie,
      origin: new URL(url).origin,
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  })
}

/** Step-7 payload, overridable. */
export function reportPayload(overrides: Record<string, unknown> = {}) {
  return {
    submissionId: crypto.randomUUID(),
    turnstileToken: CAPTCHA_PASS,
    relation: { relation: "self" },
    location: {
      provinceCode: "32",
      regencyCode: "32.73",
      districtCode: "32.73.02",
    },
    details: {
      title: "Lampu jalan padam di Coblong",
      story:
        "Lampu jalan di sepanjang jalan utama padam sejak dua minggu dan rawan.",
      categoryId: "program",
      subcategoryId: "program.infrastruktur",
      occurredOn: "2026-10-01",
      urgency: "medium",
    },
    impact: {
      groups: ["general_public"],
      affectedCount: "11_100",
      ongoing: "yes",
    },
    evidence: [],
    contact: { contactable: "no" },
    consent: {
      consents: {
        age_18_plus: true,
        accurate: true,
        public_issue: true,
        aggregate_processing: true,
      },
      consentTextVersion: CONSENT_TEXT_VERSION,
    },
    ...overrides,
  }
}

/** Reporter step 7, code. */
export async function submitReport(
  app: FullApp,
  host: string,
  cookie: string,
  overrides: Record<string, unknown> = {},
): Promise<{ code: string; evidence: { id: string }[] }> {
  const res = await app.request(`http://${host}/lapor/periksa.data`, {
    method: "POST",
    headers: {
      cookie,
      origin: `http://${host}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(reportPayload(overrides)),
  })
  if (res.status !== 201) throw new Error(`submit ${res.status}`)
  return actionData(res)
}

/** Status the form sends. */
export async function reportStatus(su: Pool, code: string): Promise<string> {
  const { rows } = await su.query<{ status: string }>(
    "SELECT status FROM reports WHERE public_code = $1",
    [code],
  )
  const status = rows[0]?.status
  if (!status) throw new Error(`no report ${code}`)
  return status
}

/** Admin review step, expects 303. */
export async function review(
  app: FullApp,
  su: Pool,
  host: string,
  staff: string,
  code: string,
  fields: Fields,
): Promise<Response> {
  return postForm(app, `http://${host}/kelola/laporan/${code}`, staff, {
    from: await reportStatus(su, code),
    ...fields,
  })
}

/** Verified, merged, new issue. */
export async function reportToIssue(
  app: FullApp,
  su: Pool,
  host: string,
  staff: string,
  code: string,
): Promise<string> {
  const steps: Fields[] = [
    { intent: "start_review" },
    { intent: "verify", method: "site_photo" },
  ]
  for (const fields of steps) {
    const res = await review(app, su, host, staff, code, fields)
    if (res.status !== 303) throw new Error(`${fields.intent} ${res.status}`)
  }
  const merged = await postForm(
    app,
    `http://${host}/kelola/laporan/${code}`,
    staff,
    {
      intent: "merge",
      target: "new",
      title: "Lampu jalan padam di Coblong",
      summary: "Lampu jalan di jalan utama Coblong padam sejak dua minggu.",
    },
  )
  const location = merged.headers.get("location") ?? ""
  const issue = /\/kelola\/isu\/([^/#?]+)/.exec(location)?.[1]
  if (merged.status !== 303 || !issue) {
    throw new Error(`merge ${merged.status} ${location}`)
  }
  return issue
}

export const CHECKLIST = [
  "no_personal_data",
  "region_matches",
  "category_complete",
  "label_checked",
]

/** Issue row the forms need. */
export async function issueRow(su: Pool, code: string) {
  const { rows } = await su.query<{
    id: string
    org_id: string
    version: number
    advocacy_status: string
    gov_status: string
  }>(
    `SELECT id, org_id, version, advocacy_status, gov_status
     FROM issues WHERE public_code = $1`,
    [code],
  )
  const row = rows[0]
  if (!row) throw new Error(`no issue ${code}`)
  return row
}

/** Publish with the full checklist. */
export async function publishIssue(
  app: FullApp,
  su: Pool,
  host: string,
  staff: string,
  code: string,
): Promise<Response> {
  const { id } = await issueRow(su, code)
  return postForm(app, `http://${host}/kelola/isu/${code}`, staff, {
    intent: "publish",
    issueId: id,
    checklist: CHECKLIST,
  })
}

/** One issue state step. */
export async function issueAction(
  app: FullApp,
  su: Pool,
  host: string,
  staff: string,
  code: string,
  fields: Fields,
): Promise<Response> {
  const row = await issueRow(su, code)
  return postForm(app, `http://${host}/kelola/isu/${code}`, staff, {
    advocacy: row.advocacy_status,
    government: row.gov_status,
    version: String(row.version),
    ...fields,
  })
}

/** Referral sent today. */
export function referFields(today: string, deadline: string): Fields {
  return {
    intent: "refer",
    agency: "Dinas PU Kota Bandung",
    channel: "agency_email",
    ticket: "PU-12",
    sentOn: today,
    deadlineOn: deadline,
  }
}
