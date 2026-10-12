import type { KategoriId } from "@/types/domain";

/**
 * Token warna chart. Divalidasi dengan dataviz `validate_palette.js` terhadap
 * permukaan kartu putih (#ffffff):
 *  - Kategori (all-pairs): #176bff, #d81623, #c8279a → semua PASS.
 *    Catatan: ungu #a500fd (identitas bansos di badge) GAGAL CVD terhadap biru
 *    (ΔE 0.5 deutan), jadi di chart bansos memakai magenta #c8279a.
 *  - Tren (2 seri): #176bff + #e57b12 → PASS; oranye < 3:1 sehingga wajib label langsung + tabel.
 *  - Ordinal (alur status): ramp biru 250→650 → PASS --ordinal.
 */
export const WARNA_KATEGORI: Record<KategoriId, string> = {
  program: "#176bff",
  bencana: "#d81623",
  bansos: "#c8279a",
};

/** Warna titik peta saat semua kategori ditampilkan */
export const WARNA_SEMUA = "#176bff";

export const WARNA_TREN = { masuk: "#176bff", terverifikasi: "#e57b12" } as const;

export const RAMP_ORDINAL = ["#86b6ef", "#5598e7", "#2a78d6", "#1c5cab", "#104281"] as const;

/** Status good/critical (palet status dataviz) — selalu berpasangan dengan ikon + label */
export const WARNA_STATUS = { baik: "#0ca30c", kritis: "#d03b3b" } as const;

export const TINTA = {
  primer: "#151515",
  sekunder: "#5e5e5e",
  redup: "#7c7c7c",
  grid: "#ece6d6",
  sumbu: "#d9cfb6",
} as const;
