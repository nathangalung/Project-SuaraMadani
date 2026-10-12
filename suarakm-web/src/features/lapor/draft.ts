import type { LaporInput } from "./types";

const KUNCI = "suarakm:draf-lapor";

export interface Draf {
  nilai: Partial<LaporInput>;
  langkah: number;
}

/** Baca draf dari localStorage. Berkas (File) tidak pernah disimpan. */
export function bacaDraf(): Draf | null {
  try {
    const mentah = localStorage.getItem(KUNCI);
    if (!mentah) return null;
    const d = JSON.parse(mentah) as Draf;
    const bersih = Object.fromEntries(
      Object.entries(d.nilai ?? {}).filter(([, v]) => v !== null && v !== undefined),
    ) as Partial<LaporInput>;
    return { nilai: bersih, langkah: Number.isInteger(d.langkah) ? d.langkah : 0 };
  } catch {
    return null;
  }
}

export function simpanDraf(nilai: Partial<LaporInput>, langkah: number) {
  try {
    const { lampiran: _abaikan, ...sisa } = nilai;
    void _abaikan;
    localStorage.setItem(KUNCI, JSON.stringify({ nilai: sisa, langkah }));
  } catch {
    /* penyimpanan tidak tersedia — abaikan */
  }
}

export function hapusDraf() {
  try {
    localStorage.removeItem(KUNCI);
  } catch {
    /* abaikan */
  }
}
