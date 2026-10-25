import { describe, expect, test } from "bun:test"
import type { DashboardSnapshot } from "../../shared/dashboard.ts"
import { DATASET_IDS, type DatasetInput, datasets } from "./datasets.ts"

function snapshot(): DashboardSnapshot {
  return {
    v: 6,
    firstReportAt: "2026-03-02",
    reports: {
      total: 64,
      decided: 50,
      verified: 40,
      verifiedShare: 0.8,
      queue: 9,
    },
    issues: { published: 26, mergedReports: 40, reportsPerIssue: 1.5 },
    verifyTime: { n: 40, medianHours: 20, p90Hours: null },
    resolution: {
      pending: 2,
      confirmed: 5,
      reopened: 3,
      claimTotal: 10,
      checked: 8,
      confirmedShare: 0.625,
    },
    trend: [
      { month: "2026-09", received: 11, verified: 8 },
      { month: "2026-10", received: 10, verified: 5 },
    ],
    trendTotal: 21,
    categories: { program: 20, bencana: 6, bansos: 0 },
    statuses: {
      awaiting_response: 12,
      responded: 6,
      in_progress: 0,
      claimed_resolved: 2,
      confirmed_resolved: 5,
      reopened: 3,
      not_competent: 0,
      not_followed_up: 0,
      closed: 0,
    },
    verifiedProvinces: {
      "all|all": { "32": 22, "34": null },
      "bencana|responded": { "32": 6 },
    },
    verifiedProvinceTotals: { "all|all": 26, "bencana|responded": 6 },
    response: {
      days: 14,
      due: 8,
      responded: 5,
      share: 0.625,
      firstResponse: { n: 6, medianDays: 6, p90Days: 12.5 },
      waiting: { d0_7: 1, d8_14: 0, d15_30: 2, d31_90: 0, d91: 0 },
      overdue: [
        { agency: "BPBD Kota Bandung", overdue: 1, referred: 2 },
        { agency: "=Dinas", overdue: 2, referred: 2 },
      ],
      clearAgencies: 1,
      unreferred: 2,
    },
    reasons: {
      rejected: {
        standard_1: 0,
        standard_2: 6,
        standard_3: null,
        standard_4: 0,
        standard_5: 0,
        standard_6: 0,
        standard_7: 0,
        standard_8: 0,
        standard_9: 0,
        standard_10: 0,
        standard_11: 0,
        standard_12: 0,
        standard_13: 0,
        out_of_scope: 5,
      },
      unverifiable: {
        no_evidence: 7,
        source_unreachable: 0,
        conflicting_information: 0,
        location_unclear: null,
      },
    },
  }
}

function input(): DatasetInput {
  return {
    snapshot: snapshot(),
    provinces: [
      { code: "32", name: "Jawa Barat" },
      { code: "34", name: "DI Yogyakarta" },
      { code: "35", name: "Jawa Timur" },
    ],
    demands: {
      counts: {
        total: 3,
        national: 1,
        regional: 2,
        active: 2,
        fulfilled: 1,
        items: 6,
        itemsFulfilled: 2,
      },
      provinces: {
        "32": {
          not_fulfilled: 1,
          partially_fulfilled: 0,
          fulfilled: 1,
          rejected: 0,
        },
      },
    },
    ranking: {
      laporan: [
        {
          code: "ISU-2026-10-0001",
          title: "Jalan berlubang",
          categoryId: "program",
          govStatus: "awaiting_response",
          regencyName: "Kota Bandung",
          districtName: null,
          reportCount: 4,
          days: 3,
        },
      ],
      terlama: [],
    },
  }
}

describe("datasets", () => {
  const all = datasets(input())

  test("one table per stable id, header matches the rows", () => {
    expect(Object.keys(all).sort()).toEqual([...DATASET_IDS].sort())
    for (const id of DATASET_IDS) {
      for (const row of all[id].rows) {
        expect(Object.keys(row).sort()).toEqual([...all[id].columns].sort())
      }
    }
  })

  test("summary numbers come from the snapshot as stored", () => {
    const rows = all.ringkasan.rows
    expect(rows).toContainEqual({ metric: "reports_total", value: 64 })
    expect(rows).toContainEqual({
      metric: "reports_verified_share",
      value: 0.8,
    })
    expect(rows).toContainEqual({ metric: "verify_p90_hours", value: null })
    expect(rows).toContainEqual({ metric: "reports_per_issue", value: 1.5 })
  })

  test("trend, categories and statuses keep the snapshot order", () => {
    expect(all.tren.rows).toEqual([
      { month: "2026-09", received: 11, verified: 8 },
      { month: "2026-10", received: 10, verified: 5 },
    ])
    expect(all.kategori.rows.map((row) => row.category)).toEqual([
      "program",
      "bencana",
      "bansos",
    ])
    expect(all.status.rows[0]).toEqual({
      status: "awaiting_response",
      issues: 12,
    })
  })

  test("suppressed cells stay null, never zero", () => {
    expect(all.alasan.rows).toContainEqual({
      outcome: "rejected",
      reason: "standard_3",
      reports: null,
    })
    expect(all.alasan.rows).toContainEqual({
      outcome: "unverifiable",
      reason: "location_unclear",
      reports: null,
    })
  })

  test("totals /data shows, suppressed as stored", () => {
    expect(all["wilayah-total"].rows).toContainEqual({
      category: "all",
      status: "all",
      verified_reports: 26,
    })
    expect(all["wilayah-total"].rows).toContainEqual({
      category: "bencana",
      status: "responded",
      verified_reports: 6,
    })
    // Missing key: no data
    expect(all["wilayah-total"].rows).toHaveLength(2)
    expect(all.ringkasan.rows).toContainEqual({
      metric: "trend_received_total",
      value: 21,
    })
  })

  test("province cells: absent is zero, null is 1 to 4", () => {
    const all32 = all.wilayah.rows.filter(
      (row) => row.category === "all" && row.status === "all",
    )
    expect(all32).toEqual([
      {
        province_code: "32",
        province_name: "Jawa Barat",
        category: "all",
        status: "all",
        verified_reports: 22,
      },
      {
        province_code: "34",
        province_name: "DI Yogyakarta",
        category: "all",
        status: "all",
        verified_reports: null,
      },
      {
        province_code: "35",
        province_name: "Jawa Timur",
        category: "all",
        status: "all",
        verified_reports: 0,
      },
    ])
    // Filters the snapshot lacks
    expect(all.wilayah.rows.some((row) => row.category === "program")).toBe(
      false,
    )
    expect(all.wilayah.rows).toHaveLength(6)
  })

  test("agencies keep the stored alphabetical order, never ranked", () => {
    expect(all["lewat-tenggat"].rows.map((row) => row.agency)).toEqual([
      "BPBD Kota Bandung",
      "=Dinas",
    ])
  })

  test("response and wait tables", () => {
    expect(all.tanggapan.rows).toContainEqual({ metric: "share", value: 0.625 })
    expect(all.tanggapan.rows).toContainEqual({
      metric: "first_response_p90_days",
      value: 12.5,
    })
    expect(all["umur-tunggu"].rows).toEqual([
      { bucket: "d0_7", issues: 1 },
      { bucket: "d8_14", issues: 0 },
      { bucket: "d15_30", issues: 2 },
      { bucket: "d31_90", issues: 0 },
      { bucket: "d91", issues: 0 },
    ])
    expect(all.penyelesaian.rows).toContainEqual({
      metric: "confirmed_share",
      value: 0.625,
    })
  })

  test("tuntutan counts are exact, every province listed", () => {
    expect(all.tuntutan.rows).toContainEqual({
      metric: "items_fulfilled",
      value: 2,
    })
    const rows = all["tuntutan-wilayah"].rows
    expect(rows).toHaveLength(3 * 4)
    expect(rows).toContainEqual({
      province_code: "32",
      province_name: "Jawa Barat",
      status: "fulfilled",
      demands: 1,
    })
    expect(rows).toContainEqual({
      province_code: "35",
      province_name: "Jawa Timur",
      status: "fulfilled",
      demands: 0,
    })
  })

  test("ranking rows carry order and rank", () => {
    expect(all["peringkat-isu"].rows).toEqual([
      {
        order: "laporan",
        rank: 1,
        code: "ISU-2026-10-0001",
        title: "Jalan berlubang",
        category: "program",
        gov_status: "awaiting_response",
        regency: "Kota Bandung",
        district: null,
        reports: 4,
        days_published: 3,
      },
    ])
  })
})
