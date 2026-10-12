import { useSyncExternalStore } from "react";

/**
 * Sesi masuk di sisi klien: cukup email yang sudah lolos verifikasi kode (disimpan di localStorage agar
 * bertahan saat halaman dimuat ulang). Ini hanya untuk tampilan — backend tetap wajib memeriksa sesinya
 * sendiri (cookie) saat laporan dikirim.
 */
export interface Sesi {
  email: string;
}

const KUNCI = "suarakm:sesi";
const pendengar = new Set<() => void>();

function baca(): string | null {
  try {
    return localStorage.getItem(KUNCI);
  } catch {
    return null;
  }
}

// useSyncExternalStore butuh snapshot yang stabil: simpan string mentahnya, bukan objek baru tiap baca
let mentah = baca();
let sesi: Sesi | null = mentah ? { email: mentah } : null;

function perbarui() {
  const baru = baca();
  if (baru === mentah) return;
  mentah = baru;
  sesi = baru ? { email: baru } : null;
  pendengar.forEach((f) => f());
}

function langganan(f: () => void) {
  pendengar.add(f);
  window.addEventListener("storage", perbarui); // ikut berubah bila masuk/keluar di tab lain
  return () => {
    pendengar.delete(f);
    window.removeEventListener("storage", perbarui);
  };
}

export function useSesi(): Sesi | null {
  return useSyncExternalStore(langganan, () => sesi, () => null);
}

export function simpanSesi(email: string) {
  try {
    localStorage.setItem(KUNCI, email);
  } catch {
    /* penyimpanan tidak tersedia — sesi hanya berlaku sampai halaman dimuat ulang */
  }
  mentah = email;
  sesi = { email };
  pendengar.forEach((f) => f());
}

export function hapusSesi() {
  try {
    localStorage.removeItem(KUNCI);
  } catch {
    /* abaikan */
  }
  mentah = null;
  sesi = null;
  pendengar.forEach((f) => f());
}
