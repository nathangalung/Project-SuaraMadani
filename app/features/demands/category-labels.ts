import { m } from "~/paraglide/messages.js"
import type { DemandCategory } from "../../../shared/demands.ts"

// Own module, keeps home small
export const CATEGORY_TEXT: Record<DemandCategory, () => string> = {
  pendidikan: m.demand_category_pendidikan,
  kesehatan: m.demand_category_kesehatan,
  lingkungan_hidup: m.demand_category_lingkungan_hidup,
  ekonomi_kesejahteraan: m.demand_category_ekonomi_kesejahteraan,
  infrastruktur_transportasi: m.demand_category_infrastruktur_transportasi,
  hukum_ham: m.demand_category_hukum_ham,
  tata_kelola_demokrasi: m.demand_category_tata_kelola_demokrasi,
  kebencanaan: m.demand_category_kebencanaan,
  bantuan_sosial: m.demand_category_bantuan_sosial,
}
