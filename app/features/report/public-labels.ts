// Public pages skip form texts
import { m } from "~/paraglide/messages.js"
import type { CategoryId, SubcategoryId } from "../../../shared/categories.ts"
import type { ReportStatus } from "../../../shared/status.ts"

export type Text = () => string

export const CATEGORY_TEXT: Record<CategoryId, Text> = {
  program: m.category_program,
  bencana: m.category_bencana,
  bansos: m.category_bansos,
}

export const SUBCATEGORY_TEXT: Record<SubcategoryId, Text> = {
  "program.pendidikan": m.sub_pendidikan,
  "program.kesehatan": m.sub_kesehatan,
  "program.perumahan": m.sub_perumahan,
  "program.administrasi_publik": m.sub_administrasi_publik,
  "program.pelayanan_pemerintah": m.sub_pelayanan_pemerintah,
  "program.kebutuhan_dasar_lainnya": m.sub_kebutuhan_dasar_lainnya,
  "program.transportasi": m.sub_transportasi,
  "program.infrastruktur": m.sub_infrastruktur,
  "program.air_bersih": m.sub_air_bersih,
  "program.sanitasi": m.sub_sanitasi,
  "program.energi": m.sub_energi,
  "program.program_pemerintah": m.sub_program_pemerintah,
  "program.kebijakan_publik": m.sub_kebijakan_publik,
  "program.harga_daya_beli": m.sub_harga_daya_beli,
  "program.pangan": m.sub_pangan,
  "program.pekerjaan": m.sub_pekerjaan,
  "bencana.banjir": m.sub_banjir,
  "bencana.longsor": m.sub_longsor,
  "bencana.kebakaran_hutan_lahan": m.sub_kebakaran_hutan_lahan,
  "bencana.gempa_bumi": m.sub_gempa_bumi,
  "bencana.erupsi": m.sub_erupsi,
  "bencana.kekeringan": m.sub_kekeringan,
  "bencana.bencana_pesisir": m.sub_bencana_pesisir,
  "bencana.bencana_lainnya": m.sub_bencana_lainnya,
  "bencana.evakuasi": m.sub_evakuasi,
  "bencana.kebutuhan_darurat": m.sub_kebutuhan_darurat,
  "bencana.infrastruktur_pascabencana": m.sub_infrastruktur_pascabencana,
  "bansos.program_bansos": m.sub_program_bansos,
  "bansos.bantuan_pangan": m.sub_bantuan_pangan,
  "bansos.bantuan_pendidikan": m.sub_bantuan_pendidikan,
  "bansos.bantuan_kesehatan": m.sub_bantuan_kesehatan,
  "bansos.perlindungan_kelompok_rentan": m.sub_perlindungan_kelompok_rentan,
  "bansos.bantuan_korban_bencana": m.sub_bantuan_korban_bencana,
  "bansos.ketepatan_sasaran": m.sub_ketepatan_sasaran,
  "bansos.distribusi_bantuan": m.sub_distribusi_bantuan,
  "bansos.keterlambatan_bantuan": m.sub_keterlambatan_bantuan,
  "bansos.penyalahgunaan_bantuan": m.sub_penyalahgunaan_bantuan,
}

export const REPORT_STATUS_TEXT: Record<ReportStatus, Text> = {
  submitted: m.report_status_submitted,
  in_review: m.report_status_in_review,
  verified: m.report_status_verified,
  unverifiable: m.report_status_unverifiable,
  rejected: m.report_status_rejected,
  merged: m.report_status_merged,
  forwarded: m.report_status_forwarded,
}

/** Label for a stored value. */
export function labelOf(
  table: Record<string, Text>,
  value: string | undefined,
): string | undefined {
  return value !== undefined && Object.hasOwn(table, value)
    ? table[value]?.()
    : undefined
}
