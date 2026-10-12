import type { z } from "zod";
import type { laporSchema } from "@/features/lapor/schema";

export type LaporFormValues = z.infer<typeof laporSchema>;

export interface SubmitReportResult {
  reportId: string;
  diterima: string;
}
