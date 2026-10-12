import type { KategoriId, ProvinsiAgregat, StatusIsu } from "@/types/domain";

export interface MapFilter {
  kategori: KategoriId | "semua";
  status: StatusIsu | "semua";
  /** "nasional" atau id provinsi */
  wilayah: string;
}

export const FILTER_AWAL: MapFilter = { kategori: "semua", status: "semua", wilayah: "nasional" };

export interface NilaiProvinsi {
  nilai: number;
  satuan: "laporan" | "isu";
  /** true bila nilai diperkirakan dari dua agregat terpisah */
  perkiraan: boolean;
}

/**
 * Nilai yang divisualkan per provinsi sesuai filter.
 * - Tanpa filter status → jumlah laporan (total atau per kategori).
 * - Dengan filter status → jumlah isu berstatus tsb.
 * - Kategori + status → perkiraan proporsional (backend sebaiknya mengirim tabulasi silang).
 */
export function nilaiProvinsi(p: ProvinsiAgregat, f: Pick<MapFilter, "kategori" | "status">): NilaiProvinsi {
  if (f.status === "semua") {
    return {
      nilai: f.kategori === "semua" ? p.jumlahLaporan : p.perKategori[f.kategori],
      satuan: "laporan",
      perkiraan: false,
    };
  }
  const isu = p.perStatus[f.status];
  if (f.kategori === "semua") return { nilai: isu, satuan: "isu", perkiraan: false };
  const porsi = p.jumlahLaporan ? p.perKategori[f.kategori] / p.jumlahLaporan : 0;
  return { nilai: Math.round(isu * porsi), satuan: "isu", perkiraan: true };
}

export function urutkanProvinsi(data: ProvinsiAgregat[], f: Pick<MapFilter, "kategori" | "status">) {
  return data
    .map((p) => ({ p, ...nilaiProvinsi(p, f) }))
    .sort((a, b) => b.nilai - a.nilai);
}

/** Batas Indonesia (Sabang–Merauke, Miangas–Rote) */
export const BATAS_INDONESIA: [[number, number], [number, number]] = [
  [-11.2, 94.6],
  [6.4, 141.2],
];
