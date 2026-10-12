import { TRACKING } from "@/mocks/tracking";
import type { ReportTracking } from "@/types/domain";
import type { LaporFormValues, SubmitReportResult } from "@/types/report";
import { http, tunda, USE_MOCK } from "./http";

/** Format Report ID: KM-2026-XXXX (PDF §13) */
export function buatReportId(tahun = new Date().getFullYear()) {
  const n = Math.floor(1000 + Math.random() * 9000);
  return `KM-${tahun}-${n}`;
}

export async function submitReport(data: LaporFormValues): Promise<SubmitReportResult> {
  if (!USE_MOCK) return http("/reports", { method: "POST", body: JSON.stringify(data) });
  return tunda({ reportId: buatReportId(), diterima: new Date().toISOString() }, 900);
}

export async function trackReport(reportId: string): Promise<ReportTracking | null> {
  const id = reportId.trim().toUpperCase().replace(/^#/, "");
  if (!USE_MOCK) return http(`/reports/${encodeURIComponent(id)}`);
  return tunda(TRACKING.find((t) => t.reportId === id) ?? null);
}
