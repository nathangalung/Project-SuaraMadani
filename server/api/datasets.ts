import type { RankedIssue } from "../../app/features/issues/issues.server.ts"
import type { IssueRanking } from "../../shared/canonical-query.ts"
import {
  CATEGORY_FILTERS,
  type Count,
  type DashboardSnapshot,
  filterKey,
  STATUS_FILTERS,
  WAIT_BUCKETS,
} from "../../shared/dashboard.ts"
import {
  FULFILMENT_STATUSES,
  type FulfilmentStatus,
} from "../../shared/status.ts"
import type { Row } from "./csv.ts"

// Stable CSV names, PLAN §5.8
export const DATASET_IDS = [
  "ringkasan",
  "tren",
  "kategori",
  "status",
  "penyelesaian",
  "alasan",
  "tanggapan",
  "umur-tunggu",
  "lewat-tenggat",
  "wilayah",
  "wilayah-total",
  "peringkat-isu",
  "tuntutan",
  "tuntutan-wilayah",
] as const
export type DatasetId = (typeof DATASET_IDS)[number]

export function isDatasetId(value: string): value is DatasetId {
  return (DATASET_IDS as readonly string[]).includes(value)
}

export type Dataset = { columns: readonly string[]; rows: Row[] }

export type DatasetInput = {
  snapshot: DashboardSnapshot
  // Map order, /data names
  provinces: readonly { code: string; name: string }[]
  demands: {
    counts: Record<
      | "total"
      | "national"
      | "regional"
      | "active"
      | "fulfilled"
      | "items"
      | "itemsFulfilled",
      number
    >
    provinces: Record<string, Record<FulfilmentStatus, number>>
  }
  ranking: Record<IssueRanking, readonly RankedIssue[]>
}

const METRIC = ["metric", "value"] as const

function metrics(entries: [string, number | null][]): Dataset {
  return {
    columns: METRIC,
    rows: entries.map(([metric, value]) => ({ metric, value })),
  }
}

/** Absent code means zero. */
function cell(counts: Record<string, Count>, code: string): Count {
  return Object.hasOwn(counts, code) ? (counts[code] ?? null) : 0
}

function regions(input: DatasetInput): Dataset {
  const rows: Row[] = []
  for (const category of CATEGORY_FILTERS) {
    for (const status of STATUS_FILTERS) {
      const counts =
        input.snapshot.verifiedProvinces[filterKey(category, status)]
      // Missing key: no data
      if (!counts) continue
      for (const province of input.provinces) {
        rows.push({
          province_code: province.code,
          province_name: province.name,
          category,
          status,
          verified_reports: cell(counts, province.code),
        })
      }
    }
  }
  return {
    columns: [
      "province_code",
      "province_name",
      "category",
      "status",
      "verified_reports",
    ],
    rows,
  }
}

/** Map header total, as shown. */
function regionTotals(input: DatasetInput): Dataset {
  const rows: Row[] = []
  for (const category of CATEGORY_FILTERS) {
    for (const status of STATUS_FILTERS) {
      const key = filterKey(category, status)
      const totals = input.snapshot.verifiedProvinceTotals
      // Missing key: no data
      if (!Object.hasOwn(totals, key)) continue
      rows.push({ category, status, verified_reports: totals[key] ?? null })
    }
  }
  return { columns: ["category", "status", "verified_reports"], rows }
}

function ranking(input: DatasetInput): Dataset {
  const rows: Row[] = []
  for (const order of ["laporan", "terlama"] as const) {
    input.ranking[order].forEach((issue, index) => {
      rows.push({
        order,
        rank: index + 1,
        code: issue.code,
        title: issue.title,
        category: issue.categoryId,
        gov_status: issue.govStatus,
        regency: issue.regencyName,
        district: issue.districtName,
        reports: issue.reportCount,
        days_published: issue.days,
      })
    })
  }
  return {
    columns: [
      "order",
      "rank",
      "code",
      "title",
      "category",
      "gov_status",
      "regency",
      "district",
      "reports",
      "days_published",
    ],
    rows,
  }
}

/** Every /data table, as shown. */
export function datasets(input: DatasetInput): Record<DatasetId, Dataset> {
  const s = input.snapshot
  const { counts } = input.demands
  return {
    ringkasan: metrics([
      ["reports_total", s.reports.total],
      ["reports_decided", s.reports.decided],
      ["reports_verified", s.reports.verified],
      ["reports_verified_share", s.reports.verifiedShare],
      ["reports_queue", s.reports.queue],
      ["issues_published", s.issues.published],
      ["issues_merged_reports", s.issues.mergedReports],
      ["reports_per_issue", s.issues.reportsPerIssue],
      ["verify_n", s.verifyTime.n],
      ["verify_median_hours", s.verifyTime.medianHours],
      ["verify_p90_hours", s.verifyTime.p90Hours],
      ["trend_received_total", s.trendTotal],
    ]),
    tren: {
      columns: ["month", "received", "verified"],
      rows: s.trend.map((point) => ({ ...point })),
    },
    kategori: {
      columns: ["category", "issues"],
      rows: Object.entries(s.categories).map(([category, issues]) => ({
        category,
        issues,
      })),
    },
    status: {
      columns: ["status", "issues"],
      rows: Object.entries(s.statuses).map(([status, issues]) => ({
        status,
        issues,
      })),
    },
    penyelesaian: metrics([
      ["pending", s.resolution.pending],
      ["confirmed", s.resolution.confirmed],
      ["reopened", s.resolution.reopened],
      ["claim_total", s.resolution.claimTotal],
      ["checked", s.resolution.checked],
      ["confirmed_share", s.resolution.confirmedShare],
    ]),
    alasan: {
      columns: ["outcome", "reason", "reports"],
      rows: (["rejected", "unverifiable"] as const).flatMap((outcome) =>
        Object.entries(s.reasons[outcome]).map(([reason, reports]) => ({
          outcome,
          reason,
          reports,
        })),
      ),
    },
    tanggapan: metrics([
      ["days", s.response.days],
      ["due", s.response.due],
      ["responded", s.response.responded],
      ["share", s.response.share],
      ["first_response_n", s.response.firstResponse.n],
      ["first_response_median_days", s.response.firstResponse.medianDays],
      ["first_response_p90_days", s.response.firstResponse.p90Days],
      ["clear_agencies", s.response.clearAgencies],
      ["unreferred", s.response.unreferred],
    ]),
    "umur-tunggu": {
      columns: ["bucket", "issues"],
      rows: WAIT_BUCKETS.map(({ id }) => ({
        bucket: id,
        issues: s.response.waiting[id],
      })),
    },
    "lewat-tenggat": {
      columns: ["agency", "overdue", "referred"],
      rows: s.response.overdue.map((entry) => ({ ...entry })),
    },
    wilayah: regions(input),
    "wilayah-total": regionTotals(input),
    "peringkat-isu": ranking(input),
    tuntutan: metrics([
      ["total", counts.total],
      ["national", counts.national],
      ["regional", counts.regional],
      ["active", counts.active],
      ["fulfilled", counts.fulfilled],
      ["items", counts.items],
      ["items_fulfilled", counts.itemsFulfilled],
    ]),
    "tuntutan-wilayah": {
      columns: ["province_code", "province_name", "status", "demands"],
      rows: input.provinces.flatMap((province) =>
        FULFILMENT_STATUSES.map((status) => ({
          province_code: province.code,
          province_name: province.name,
          status,
          demands: input.demands.provinces[province.code]?.[status] ?? 0,
        })),
      ),
    },
  }
}
