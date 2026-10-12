/**
 * Query key & option terpusat (TanStack Query) supaya komponen tidak tahu
 * apakah data datang dari mock atau API.
 */
import { queryOptions } from "@tanstack/react-query";
import type { IssueFilter } from "@/types/domain";
import { getIssue, getIssues, getTuntutan } from "./issues.service";
import { getAgregatProvinsi, getHeadline, getSebaranKepuasan, getStatistik, getTren } from "./stats.service";
import { trackReport } from "./reports.service";

export const q = {
  statistik: () => queryOptions({ queryKey: ["statistik"], queryFn: getStatistik }),
  provinsi: () => queryOptions({ queryKey: ["provinsi"], queryFn: getAgregatProvinsi }),
  tren: () => queryOptions({ queryKey: ["tren"], queryFn: getTren }),
  kepuasan: () => queryOptions({ queryKey: ["kepuasan"], queryFn: getSebaranKepuasan }),
  headline: () => queryOptions({ queryKey: ["headline"], queryFn: getHeadline }),
  tuntutan: () => queryOptions({ queryKey: ["tuntutan"], queryFn: getTuntutan }),
  issues: (f: IssueFilter = {}) => queryOptions({ queryKey: ["issues", f], queryFn: () => getIssues(f) }),
  issue: (id: string) => queryOptions({ queryKey: ["issue", id], queryFn: () => getIssue(id) }),
  tracking: (id: string) =>
    queryOptions({ queryKey: ["tracking", id], queryFn: () => trackReport(id), enabled: id.length > 0 }),
};
