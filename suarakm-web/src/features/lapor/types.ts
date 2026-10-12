import type { z } from "zod";
import type { laporSchema } from "./schema";

/** Nilai form sebelum di-parse zod (default belum terisi) */
export type LaporInput = z.input<typeof laporSchema>;
